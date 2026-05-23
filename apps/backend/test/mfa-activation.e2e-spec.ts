import { type INestApplication, HttpStatus } from '@nestjs/common';
import { authenticator } from 'otplib';
import { DataSource } from 'typeorm';

import { ERROR_CODES } from '../src/common/errors/error-codes';
import { createE2eApp, type E2eAppHandle } from './helpers/app';
import { seedUserAndLogin } from './helpers/auth';
import { resetTables } from './helpers/db';

/**
 * Section 10.x (BE-TEST-08) — MFA TOTP activation flow exercised end-to-end:
 *
 *   1. `POST /auth/mfa/setup` (authenticated) returns a base32 secret +
 *      `otpauth://` URI. Row is `enabled=false` after this step.
 *   2. `POST /auth/mfa/verify` with a TOTP code computed from the secret
 *      via `otplib.authenticator.generate(secret)` flips the row to
 *      `enabled=true` and returns 10 backup codes ONCE.
 *   3. Backup codes in the response are 8-char base32 (excludes 0/O/1/I/L).
 *   4. DB-side: row has `enabled=true`, `activated_at IS NOT NULL`,
 *      `backup_codes_hashed` has 10 entries, each an argon2id hash
 *      (starts with `$argon2id$`).
 *
 * The login flow continuation (`/auth/mfa/verify-challenge`) is covered
 * by the unit spec; here we just want to prove the activation wiring
 * goes through the real argon2 hashing + DB persistence.
 */
describe('e2e: MFA activation flow (Section 10.x, BE-TEST-08)', () => {
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

  it('happy path: setup → verify-with-real-totp → enabled=true + 10 hashed backup codes persisted', async () => {
    const user = await seedUserAndLogin(app, 'mfa-flow@e2e.test');

    // 1. Setup — returns secret + otpauth URI.
    const setup = await handle.http
      .post('/auth/mfa/setup')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Content-Type', 'application/json')
      .send();

    expect(setup.status).toBe(HttpStatus.OK);
    const setupData = setup.body.data as { secret: string; otpauthUri: string };
    expect(setupData.secret).toMatch(/^[A-Z2-7]+$/);
    expect(setupData.otpauthUri).toMatch(/^otpauth:\/\/totp\//);

    // 2. Compute a fresh TOTP code from the returned secret and verify.
    const code = authenticator.generate(setupData.secret);
    const verify = await handle.http
      .post('/auth/mfa/verify')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Content-Type', 'application/json')
      .send({ code });

    expect(verify.status).toBe(HttpStatus.OK);
    const backupCodes = (verify.body.data as { backupCodes: string[] }).backupCodes;
    expect(backupCodes).toHaveLength(10);
    for (const c of backupCodes) {
      expect(c).toMatch(/^[A-Z2-7]{8}$/);
    }

    // 3. DB-side proof.
    const row = (
      (await dataSource.query(
        'SELECT enabled, activated_at, backup_codes_hashed FROM mfa_configs WHERE user_id = $1',
        [user.userId],
      )) as ReadonlyArray<{
        enabled: boolean;
        activated_at: Date | null;
        backup_codes_hashed: string[];
      }>
    )[0];
    expect(row.enabled).toBe(true);
    expect(row.activated_at).not.toBeNull();
    expect(row.backup_codes_hashed).toHaveLength(10);
    for (const hash of row.backup_codes_hashed) {
      expect(hash).toMatch(/^\$argon2id\$/);
    }
  });

  it('rejects a bogus TOTP code with 401 AUTH_MFA_INVALID_CODE + emits auth.mfa_verification_failed', async () => {
    const user = await seedUserAndLogin(app, 'mfa-bad@e2e.test');
    await handle.http
      .post('/auth/mfa/setup')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send();

    const verify = await handle.http
      .post('/auth/mfa/verify')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Content-Type', 'application/json')
      .send({ code: '000000' });

    expect(verify.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(verify.body).toMatchObject({
      data: null,
      error: { code: ERROR_CODES.AUTH_MFA_INVALID_CODE },
    });

    const events = (await dataSource.query(
      'SELECT event_type FROM auth_events WHERE event_type = $1 AND user_id = $2',
      ['auth.mfa_verification_failed', user.userId],
    )) as ReadonlyArray<{ event_type: string }>;
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Row stays `enabled=false` because verify failed.
    const row = (
      (await dataSource.query('SELECT enabled FROM mfa_configs WHERE user_id = $1', [
        user.userId,
      ])) as ReadonlyArray<{ enabled: boolean }>
    )[0];
    expect(row.enabled).toBe(false);
  });

  it('verify without prior setup → 401 AUTH_MFA_NOT_ENROLLED', async () => {
    const user = await seedUserAndLogin(app, 'mfa-no-setup@e2e.test');

    const verify = await handle.http
      .post('/auth/mfa/verify')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Content-Type', 'application/json')
      .send({ code: '123456' });

    expect(verify.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(verify.body).toMatchObject({
      data: null,
      error: { code: ERROR_CODES.AUTH_MFA_NOT_ENROLLED },
    });
  });

  it('replay of setup after activation → 409 AUTH_MFA_ALREADY_ENABLED', async () => {
    const user = await seedUserAndLogin(app, 'mfa-already@e2e.test');
    const setup = await handle.http
      .post('/auth/mfa/setup')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send();
    const secret = (setup.body.data as { secret: string }).secret;
    await handle.http
      .post('/auth/mfa/verify')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Content-Type', 'application/json')
      .send({ code: authenticator.generate(secret) });

    const replay = await handle.http
      .post('/auth/mfa/setup')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send();

    expect(replay.status).toBe(HttpStatus.CONFLICT);
    expect(replay.body).toMatchObject({
      data: null,
      error: { code: ERROR_CODES.AUTH_MFA_ALREADY_ENABLED },
    });
  });
});
