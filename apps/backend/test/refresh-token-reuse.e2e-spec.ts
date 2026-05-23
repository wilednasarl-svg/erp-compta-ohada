import { type INestApplication, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ERROR_CODES } from '../src/common/errors/error-codes';
import { createE2eApp, type E2eAppHandle } from './helpers/app';
import { seedUserAndLogin } from './helpers/auth';
import { resetTables } from './helpers/db';

/**
 * Section 10.x (BE-TEST-05) — Refresh-token rotation + reuse detection.
 *
 * Spec scenarios (`specs/auth/spec.md` — "Refresh token rotation with
 * reuse detection") exercised end-to-end against the real
 * `POST /auth/refresh` route:
 *
 *   1. Rotation: a successful refresh invalidates the presented token and
 *      mints a new one within the same family. Re-refresh with the freshly
 *      issued token must keep working.
 *   2. Reuse detection: presenting an already-rotated token must yield
 *      401 AUTH_REFRESH_REUSE AND revoke the entire active chain (so the
 *      legitimate-looking T2 the attacker may also hold is killed),
 *      AND emit an `auth.refresh_token_reuse_detected` event to the
 *      forensic journal.
 *   3. Malformed token: any garbage in the body must be rejected 401
 *      without leaking implementation details.
 *
 * The unit spec (`refresh-token.service.spec.ts`) already pins the
 * service-level behaviour with mocks; this suite proves the wire path
 * (controller + DTO + filter + interceptor + repo + journal) is hooked
 * up correctly.
 */
interface AuthEventRow {
  readonly event_type: string;
  readonly user_id: string | null;
}

describe('e2e: refresh token rotation + reuse detection (Section 10.x, BE-TEST-05)', () => {
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

  it('rotates a valid refresh token: old token is invalidated, new token works', async () => {
    const user = await seedUserAndLogin(app, 'rotate@e2e.test');
    const t1 = user.refreshToken;

    // First refresh: T1 -> T2 (success).
    const first = await handle.http
      .post('/auth/refresh')
      .set('Content-Type', 'application/json')
      .send({ refreshToken: t1 });

    expect(first.status).toBe(HttpStatus.OK);
    expect(first.body).toMatchObject({ error: null });
    const t2 = (first.body.data as { refreshToken: string }).refreshToken;
    expect(typeof t2).toBe('string');
    expect(t2).not.toBe(t1);

    // Second refresh with T2: should succeed and rotate again to T3.
    const second = await handle.http
      .post('/auth/refresh')
      .set('Content-Type', 'application/json')
      .send({ refreshToken: t2 });

    expect(second.status).toBe(HttpStatus.OK);
    expect(second.body).toMatchObject({ error: null });
    const t3 = (second.body.data as { refreshToken: string }).refreshToken;
    expect(typeof t3).toBe('string');
    expect(t3).not.toBe(t2);
    expect(t3).not.toBe(t1);
  });

  it('detects reuse of an already-rotated refresh token: rejects 401 + revokes the active token chain + emits audit', async () => {
    const user = await seedUserAndLogin(app, 'reuse@e2e.test');
    const t1 = user.refreshToken;

    // Legitimate rotation: T1 -> T2. T1 is now consumed.
    const rotated = await handle.http
      .post('/auth/refresh')
      .set('Content-Type', 'application/json')
      .send({ refreshToken: t1 });
    expect(rotated.status).toBe(HttpStatus.OK);
    const t2 = (rotated.body.data as { refreshToken: string }).refreshToken;

    // The attack: replay the already-consumed T1. Reuse detection MUST
    // trip — 401 AUTH_REFRESH_REUSE.
    const replay = await handle.http
      .post('/auth/refresh')
      .set('Content-Type', 'application/json')
      .send({ refreshToken: t1 });

    expect(replay.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(replay.body).toMatchObject({
      data: null,
      error: { code: ERROR_CODES.AUTH_REFRESH_REUSE },
    });

    // Cascade: T2 (which the attacker may also hold via another channel)
    // MUST now be rejected because the whole family was revoked. Once a
    // revoked token is presented to `rotate`, the service trips reuse
    // detection again — so we expect AUTH_REFRESH_REUSE here too.
    const cascade = await handle.http
      .post('/auth/refresh')
      .set('Content-Type', 'application/json')
      .send({ refreshToken: t2 });

    expect(cascade.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(cascade.body).toMatchObject({
      data: null,
      error: { code: ERROR_CODES.AUTH_REFRESH_REUSE },
    });

    // Audit journal: at least one `auth.refresh_token_reuse_detected`
    // row must be linked to this user (the replay; the cascade also
    // emits one, but we only need to prove the forensic trail exists).
    const events = (await dataSource.query(
      'SELECT event_type, user_id FROM auth_events WHERE event_type = $1 AND user_id = $2',
      ['auth.refresh_token_reuse_detected', user.userId],
    )) as ReadonlyArray<AuthEventRow>;
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const row of events) {
      expect(row.event_type).toBe('auth.refresh_token_reuse_detected');
      expect(row.user_id).toBe(user.userId);
    }
  });

  it('refuses a refresh request with a malformed refresh token with 401', async () => {
    const response = await handle.http
      .post('/auth/refresh')
      .set('Content-Type', 'application/json')
      .send({ refreshToken: 'not.a.real.jwt' });

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(response.body).toMatchObject({
      data: null,
      error: { code: ERROR_CODES.AUTH_INVALID_TOKEN },
    });
  });
});
