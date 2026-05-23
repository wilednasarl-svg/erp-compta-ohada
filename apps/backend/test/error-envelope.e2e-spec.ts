import { type INestApplication, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ERROR_CODES } from '../src/common/errors/error-codes';
import { createE2eApp, type E2eAppHandle } from './helpers/app';
import { seedUserAndLogin } from './helpers/auth';
import { resetTables } from './helpers/db';

/**
 * Section 10.x (BE-TEST-09) — error envelope contract.
 *
 * Every failure response across the API must match the shape produced
 * by `AllExceptionsFilter` (BE-BOOT-06):
 *
 *   { data: null, error: { code, message, details? } }
 *
 * The codes themselves are unit-tested in `app-exception.spec.ts` and
 * `all-exceptions.filter.spec.ts`; this suite proves the envelope
 * survives the full HTTP stack (controller → interceptor → filter)
 * by hitting one representative path per code group.
 *
 * Coverage isn't exhaustive (every code from the catalogue) — that
 * would duplicate logic already pinned by unit tests. We pick the
 * most representative scenarios per group + the framework-generated
 * codes (`VALIDATION_ERROR`, `NOT_FOUND`) that have no dedicated
 * filter unit test.
 */
describe('e2e: failure envelope contract (Section 10.x, BE-TEST-09)', () => {
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

  it('VALIDATION_ERROR (422): ValidationPipe failure shape with per-field details', async () => {
    const response = await handle.http
      .post('/auth/signup')
      .set('Content-Type', 'application/json')
      .send({ email: 'not-an-email', password: 'short' });

    expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(response.body).toMatchObject({
      data: null,
      error: { code: 'VALIDATION_ERROR' },
    });
    const details = (response.body.error as { details: { fields: string[] } }).details;
    expect(Array.isArray(details.fields)).toBe(true);
    expect(details.fields.length).toBeGreaterThan(0);
  });

  it('AUTH_WEAK_PASSWORD (422): service-level rejection has the spec code (not generic VALIDATION_ERROR)', async () => {
    const response = await handle.http
      .post('/auth/signup')
      .set('Content-Type', 'application/json')
      .send({ email: 'weak@e2e.test', password: 'shortie' });

    // The DTO accepts shortie (>= 1 char minimum at DTO layer); the
    // 12-char policy is enforced by AuthService.signup → AUTH_WEAK_PASSWORD.
    expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(response.body).toMatchObject({
      data: null,
      error: {
        code: ERROR_CODES.AUTH_WEAK_PASSWORD,
        details: { field: 'password' },
      },
    });
  });

  it('AUTH_EMAIL_TAKEN (409): duplicate signup', async () => {
    await seedUserAndLogin(app, 'taken@e2e.test');

    const response = await handle.http
      .post('/auth/signup')
      .set('Content-Type', 'application/json')
      .send({ email: 'taken@e2e.test', password: 'AnotherValidPass2026!' });

    expect(response.status).toBe(HttpStatus.CONFLICT);
    expect(response.body).toMatchObject({
      data: null,
      error: { code: ERROR_CODES.AUTH_EMAIL_TAKEN },
    });
  });

  it('AUTH_INVALID_CREDENTIALS (401): wrong password', async () => {
    await seedUserAndLogin(app, 'wrong-pwd@e2e.test', 'CorrectPass2026!');

    const response = await handle.http
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'wrong-pwd@e2e.test', password: 'WrongPass2026!' });

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(response.body).toMatchObject({
      data: null,
      error: { code: ERROR_CODES.AUTH_INVALID_CREDENTIALS },
    });
  });

  it('AUTH_INVALID_TOKEN (401): missing Bearer on a protected route (BE-RBAC-06 global JwtAuthGuard)', async () => {
    const response = await handle.http.get('/organizations');

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(response.body).toMatchObject({
      data: null,
      error: { code: ERROR_CODES.AUTH_INVALID_TOKEN },
    });
  });

  it('NOT_FOUND (404): unknown route gets reshaped to the envelope (no Nest default JSON leak)', async () => {
    // Route is @Public via no match — JwtAuthGuard global on a non-route
    // doesn't fire (no handler), Nest's 404 handler is what triggers.
    // The filter wraps it into the envelope all the same.
    const response = await handle.http.get('/this-does-not-exist');

    expect(response.status).toBe(HttpStatus.NOT_FOUND);
    expect(response.body).toMatchObject({
      data: null,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('success envelope (sanity): every 2xx response is wrapped in { data, error: null }', async () => {
    const response = await handle.http.get('/health/db');

    expect(response.status).toBe(HttpStatus.OK);
    expect(response.body).toMatchObject({
      data: { ok: true },
      error: null,
    });
  });
});
