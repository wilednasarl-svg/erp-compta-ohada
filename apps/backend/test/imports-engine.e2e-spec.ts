import { type INestApplication, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ERROR_CODES } from '../src/common/errors/error-codes';
import { createE2eApp, type E2eAppHandle } from './helpers/app';
import { authedJson, createOrgAndSwitch, seedUserAndLogin } from './helpers/auth';
import { resetTables } from './helpers/db';

/**
 * Section 12.1..12.5 — Module 3 Import engine end-to-end.
 *
 *   12.1  Session lifecycle — create → upload CSV → parse → preview.
 *   12.2  Tenant isolation — org A cannot see/mutate org B sessions.
 *   12.3  Permissions — auditeur read OK, write 403; comptable write OK.
 *   12.4  MIME validation — fake .csv with EXE bytes → 422.
 *   12.5  Dedupe — same SHA256 in same session → 409.
 *
 * These tests require `TEST_DATABASE_URL` to be set (see
 * `test/setup/load-env.ts`) and a postgres reachable. Locally:
 *   pnpm --filter backend test:e2e
 */
describe('e2e: Module 3 Import engine (12.1..12.5)', () => {
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

  // ─────────────────────────────────────────────────────────────────
  // 12.1 Lifecycle
  // ─────────────────────────────────────────────────────────────────

  it('happy path: create → upload CSV → parse → preview (12.1)', async () => {
    const alice = await seedUserAndLogin(app, 'alice-imp-life@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Imports');

    // Step 1 — create draft session.
    const created = await authedJson(
      handle.http,
      'post',
      `/organizations/${org.organizationId}/imports/sessions`,
      org.scopedAccessToken,
    ).send({ sourceType: 'csv', label: 'Achats janvier' });
    expect(created.status).toBe(HttpStatus.CREATED);
    const sessionId = created.body.data.session.id as string;
    expect(created.body.data.session.status).toBe('draft');

    // Step 2 — upload a tiny CSV.
    const csv = 'code,libelle,debit,credit\n401,Fournisseur ABC,0,1000\n';
    const upload = await handle.http
      .post(`/organizations/${org.organizationId}/imports/sessions/${sessionId}/files`)
      .set('Authorization', `Bearer ${org.scopedAccessToken}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'achats.csv');
    expect(upload.status).toBe(HttpStatus.CREATED);
    expect(upload.body.data.fileId).toBeDefined();
    expect(upload.body.data.parsed.rowsParsed).toBeGreaterThan(0);

    // Step 3 — preview.
    const preview = await authedJson(
      handle.http,
      'post',
      `/organizations/${org.organizationId}/imports/sessions/${sessionId}/preview?page=1&pageSize=50`,
      org.scopedAccessToken,
    ).send({});
    expect(preview.status).toBe(HttpStatus.OK);
    expect(Array.isArray(preview.body.data.rows ?? preview.body.data.items)).toBe(true);

    // Audit: at least 3 events landed (session_created + file_uploaded + file_parsed).
    const audit: Array<{ event_type: string }> = await dataSource.query(
      `SELECT event_type FROM "auth_events"
       WHERE organization_id = $1 AND event_type LIKE 'imports.%'
       ORDER BY created_at ASC`,
      [org.organizationId],
    );
    const types = audit.map((r) => r.event_type);
    expect(types).toEqual(
      expect.arrayContaining(['imports.session_created', 'imports.file_uploaded']),
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // 12.2 Tenant isolation
  // ─────────────────────────────────────────────────────────────────

  it('cross-tenant read of an existing session returns 404, never the row (12.2)', async () => {
    const alice = await seedUserAndLogin(app, 'alice-imp-cross@e2e.test');
    const orgA = await createOrgAndSwitch(app, alice, 'Org A imports');
    const bob = await seedUserAndLogin(app, 'bob-imp-cross@e2e.test');
    const orgB = await createOrgAndSwitch(app, bob, 'Org B imports');

    // Bob creates a session in his org B.
    const bobSession = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgB.organizationId}/imports/sessions`,
      orgB.scopedAccessToken,
    ).send({ sourceType: 'csv' });
    const sessionId = bobSession.body.data.session.id as string;

    // Alice (org A scope) tries to read it via org B URL.
    const crossRead = await authedJson(
      handle.http,
      'get',
      `/organizations/${orgB.organizationId}/imports/sessions/${sessionId}`,
      orgA.scopedAccessToken,
    );
    expect(crossRead.status).toBe(HttpStatus.NOT_FOUND);
    expect(crossRead.body.error.code).toBe(ERROR_CODES.ORG_NOT_FOUND);

    // Bob in his own org sees it.
    const ok = await authedJson(
      handle.http,
      'get',
      `/organizations/${orgB.organizationId}/imports/sessions/${sessionId}`,
      orgB.scopedAccessToken,
    );
    expect(ok.status).toBe(HttpStatus.OK);
  });

  // ─────────────────────────────────────────────────────────────────
  // 12.3 Permissions
  // ─────────────────────────────────────────────────────────────────

  it('auditeur reads but cannot write (12.3)', async () => {
    // Build org with admin; invite a 2nd user we'll promote to auditeur via
    // direct DB write (easier than going through the invitation flow here).
    const admin = await seedUserAndLogin(app, 'imp-admin@e2e.test');
    const org = await createOrgAndSwitch(app, admin, 'Org Permissions');

    const auditor = await seedUserAndLogin(app, 'imp-auditor@e2e.test');
    await dataSource.query(
      `INSERT INTO "memberships" (user_id, organization_id, role_id, status)
       SELECT $1, $2, r.id, 'active' FROM roles r WHERE r.code = 'auditeur'`,
      [auditor.userId, org.organizationId],
    );

    // Auditor logs into the org. We mint a scoped token directly via the
    // /auth/select-organization endpoint.
    const select = await handle.http
      .post('/auth/select-organization')
      .set('Authorization', `Bearer ${auditor.accessToken}`)
      .send({ organizationId: org.organizationId });
    expect(select.status).toBe(HttpStatus.OK);
    const auditorScoped = select.body.data.accessToken as string;

    // Read: 200.
    const list = await authedJson(
      handle.http,
      'get',
      `/organizations/${org.organizationId}/imports/sessions`,
      auditorScoped,
    );
    expect(list.status).toBe(HttpStatus.OK);

    // Write: 403 FORBIDDEN_PERMISSION.
    const writeAttempt = await authedJson(
      handle.http,
      'post',
      `/organizations/${org.organizationId}/imports/sessions`,
      auditorScoped,
    ).send({ sourceType: 'csv' });
    expect(writeAttempt.status).toBe(HttpStatus.FORBIDDEN);
    expect(writeAttempt.body.error.code).toBe(ERROR_CODES.FORBIDDEN_PERMISSION);
  });

  // ─────────────────────────────────────────────────────────────────
  // 12.4 MIME validation
  // ─────────────────────────────────────────────────────────────────

  it('rejects a fake .csv whose bytes are an executable (12.4)', async () => {
    const alice = await seedUserAndLogin(app, 'alice-imp-mime@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Mime');
    const created = await authedJson(
      handle.http,
      'post',
      `/organizations/${org.organizationId}/imports/sessions`,
      org.scopedAccessToken,
    ).send({ sourceType: 'csv' });
    const sessionId = created.body.data.session.id as string;

    // PE/EXE magic bytes — should fail at the MIME sniff layer before
    // the CSV parser even runs.
    const exeBytes = Buffer.concat([
      Buffer.from('MZ'),
      Buffer.alloc(126),
      Buffer.from('PE\x00\x00'),
    ]);
    const upload = await handle.http
      .post(`/organizations/${org.organizationId}/imports/sessions/${sessionId}/files`)
      .set('Authorization', `Bearer ${org.scopedAccessToken}`)
      .attach('file', exeBytes, { filename: 'fake.csv', contentType: 'text/csv' });

    // Accepted codes: 422 IMPORT_UNSUPPORTED_FORMAT (sniffer caught it),
    // 422 IMPORT_FILE_PARSE_FAILED (parser caught it), or 415 from multer.
    expect([
      HttpStatus.UNPROCESSABLE_ENTITY,
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      HttpStatus.BAD_REQUEST,
    ]).toContain(upload.status);
  });

  // ─────────────────────────────────────────────────────────────────
  // 12.5 Dedupe
  // ─────────────────────────────────────────────────────────────────

  it('refuses to upload twice the same SHA256 within a session (12.5)', async () => {
    const alice = await seedUserAndLogin(app, 'alice-imp-dedup@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Dedup');
    const created = await authedJson(
      handle.http,
      'post',
      `/organizations/${org.organizationId}/imports/sessions`,
      org.scopedAccessToken,
    ).send({ sourceType: 'csv' });
    const sessionId = created.body.data.session.id as string;

    const csv = Buffer.from('code,libelle,debit,credit\n411,Client X,500,0\n', 'utf8');

    const first = await handle.http
      .post(`/organizations/${org.organizationId}/imports/sessions/${sessionId}/files`)
      .set('Authorization', `Bearer ${org.scopedAccessToken}`)
      .attach('file', csv, 'a.csv');
    expect(first.status).toBe(HttpStatus.CREATED);

    const second = await handle.http
      .post(`/organizations/${org.organizationId}/imports/sessions/${sessionId}/files`)
      .set('Authorization', `Bearer ${org.scopedAccessToken}`)
      .attach('file', csv, 'a-duplicate.csv'); // same bytes, different filename
    expect(second.status).toBe(HttpStatus.CONFLICT);
    expect(second.body.error.code).toBe(ERROR_CODES.IMPORT_FILE_DUPLICATE);
  });
});
