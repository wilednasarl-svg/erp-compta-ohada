import { type INestApplication, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ERROR_CODES } from '../src/common/errors/error-codes';
import { createE2eApp, type E2eAppHandle } from './helpers/app';
import { createOrgAndSwitch, seedUserAndLogin } from './helpers/auth';
import { resetTables } from './helpers/db';

/**
 * Section 10.x (BE-TEST-06 + BE-TEST-07) — invitation single-use and
 * expiration paths covered end-to-end through the public accept route.
 *
 * The unit spec (`invitations.service.spec.ts`) pins the orchestration
 * with mocks; this suite proves the wire path:
 *   - `POST /organizations/:id/invitations` (admin issues + DB-store +
 *     email DRY-RUN)
 *   - `POST /auth/invitations/accept` (public, JWT verified, DB
 *     status flip, membership created)
 *
 * Test-side trick: the JWT plaintext is not returned by the create
 * endpoint (only the metadata is — the plaintext is shipped only by
 * email). To exercise accept end-to-end without parsing the dry-run
 * log line, the spec mints a matching JWT via `JwtTokenService` and
 * writes the corresponding SHA-256 `token_hash` directly so the
 * `findById` lookup + hash check both pass.
 */
describe('e2e: invitation single-use + expiration (Section 10.x, BE-TEST-06/07)', () => {
  let handle: E2eAppHandle;
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    handle = await createE2eApp();
    app = handle.app;
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTables(dataSource);
  });

  /**
   * Sign a real invitation JWT bound to the row + patch its
   * `token_hash` so `POST /auth/invitations/accept` resolves the row.
   * Returns the plaintext JWT.
   */
  async function mintInvitationToken(input: {
    inviterUserId: string;
    organizationId: string;
    invitationId: string;
    email: string;
    roleId: string;
  }): Promise<string> {
    const { JwtTokenService } = await import('../src/modules/auth/services/jwt-token.service');
    const jwt = app.get(JwtTokenService);
    // `email` was removed from the invitation JWT claim payload to avoid
    // PII leakage via cached link previews / anti-phishing scanners. The
    // invitee's email is now read from the DB row keyed on `invitation_id`.
    const token = jwt.signInvitationToken({
      sub: input.inviterUserId,
      invitationId: input.invitationId,
      orgId: input.organizationId,
      roleId: input.roleId,
    });
    const { createHash } = await import('node:crypto');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await dataSource.query(
      'UPDATE invitations SET token_hash = $1 WHERE id = $2 AND organization_id = $3',
      [tokenHash, input.invitationId, input.organizationId],
    );
    return token;
  }

  async function createPendingInvitation(
    adminBearer: string,
    organizationId: string,
    invitee: string,
  ): Promise<{ invitationId: string; roleId: string }> {
    const response = await handle.http
      .post(`/organizations/${organizationId}/invitations`)
      .set('Authorization', `Bearer ${adminBearer}`)
      .set('Content-Type', 'application/json')
      .send({ email: invitee, roleCode: 'comptable' });
    expect(response.status).toBe(HttpStatus.CREATED);
    const invitationId = (response.body.data as { invitation: { id: string } }).invitation.id;
    const roleRow = (
      (await dataSource.query('SELECT id FROM roles WHERE code = $1', [
        'comptable',
      ])) as ReadonlyArray<{ id: string }>
    )[0];
    return { invitationId, roleId: roleRow.id };
  }

  it('BE-TEST-06: replaying an already-accepted invitation → 409 INVITATION_ALREADY_USED', async () => {
    const admin = await seedUserAndLogin(app, 'inviter@e2e.test');
    const org = await createOrgAndSwitch(app, admin, 'Invitation Org');
    const { invitationId, roleId } = await createPendingInvitation(
      org.scopedAccessToken,
      org.organizationId,
      'invitee-once@e2e.test',
    );
    const token = await mintInvitationToken({
      inviterUserId: admin.userId,
      organizationId: org.organizationId,
      invitationId,
      email: 'invitee-once@e2e.test',
      roleId,
    });

    // First accept — happy path. New user, signup branch.
    const first = await handle.http
      .post('/auth/invitations/accept')
      .set('Content-Type', 'application/json')
      .send({ token, password: 'AcceptPass2026!', firstName: 'Invitee' });
    expect(first.status).toBe(HttpStatus.CREATED);
    expect(first.body).toMatchObject({ error: null });

    // Replay the same token — must trip single-use.
    const replay = await handle.http
      .post('/auth/invitations/accept')
      .set('Content-Type', 'application/json')
      .send({ token, password: 'AcceptPass2026!', firstName: 'Invitee' });
    expect(replay.status).toBe(HttpStatus.CONFLICT);
    expect(replay.body).toMatchObject({
      data: null,
      error: { code: ERROR_CODES.INVITATION_ALREADY_USED },
    });
  });

  it('BE-TEST-07: backdated expires_at → 410 INVITATION_EXPIRED + DB row flipped to status=expired', async () => {
    const admin = await seedUserAndLogin(app, 'inviter-exp@e2e.test');
    const org = await createOrgAndSwitch(app, admin, 'Expiration Org');
    const { invitationId, roleId } = await createPendingInvitation(
      org.scopedAccessToken,
      org.organizationId,
      'invitee-expired@e2e.test',
    );
    const token = await mintInvitationToken({
      inviterUserId: admin.userId,
      organizationId: org.organizationId,
      invitationId,
      email: 'invitee-expired@e2e.test',
      roleId,
    });

    // Backdate `expires_at` to yesterday. The JWT itself is still
    // signature-valid (7-day TTL not yet elapsed in real time), so the
    // DB-side expiry check is what's exercised here.
    await dataSource.query(
      "UPDATE invitations SET expires_at = NOW() - INTERVAL '1 day' WHERE id = $1",
      [invitationId],
    );

    const response = await handle.http
      .post('/auth/invitations/accept')
      .set('Content-Type', 'application/json')
      .send({ token, password: 'AcceptPass2026!', firstName: 'Invitee' });

    expect(response.status).toBe(HttpStatus.GONE);
    expect(response.body).toMatchObject({
      data: null,
      error: { code: ERROR_CODES.INVITATION_EXPIRED },
    });

    // Side-effect: the row is flipped to `expired` so the next replay
    // short-circuits before re-checking the clock.
    const statusRow = (
      (await dataSource.query('SELECT status FROM invitations WHERE id = $1', [
        invitationId,
      ])) as ReadonlyArray<{ status: string }>
    )[0];
    expect(statusRow.status).toBe('expired');
  });
});
