import { type INestApplication, HttpStatus } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { DataSource } from 'typeorm';

import { ERROR_CODES } from '../src/common/errors/error-codes';
import { createE2eApp, type E2eAppHandle } from './helpers/app';
import { authedJson, createOrgAndSwitch, seedUserAndLogin } from './helpers/auth';
import { resetTables } from './helpers/db';

/**
 * Section 10.x — Deny-by-default (BE-TEST-03).
 *
 * Spec scenario (`specs/auth/spec.md`): every business route MUST require
 * a valid Bearer access token unless explicitly opted out with `@Public()`.
 * The contract is enforced by the global `APP_GUARD` (`JwtAuthGuard`)
 * wired in `app.module.ts`.
 *
 * Concretely we verify:
 *   - A gated route (`GET /organizations/:id/members`) is refused with
 *     401 `AUTH_INVALID_TOKEN` for: missing Authorization header,
 *     malformed Bearer token, and a token signed by a foreign secret.
 *   - The same gated route returns 200 for a properly scoped Bearer
 *     (sanity of the happy path so the four 401 assertions actually
 *     prove deny-by-default, not a broken route).
 *   - The opt-out works: `POST /auth/signup` and `GET /health` are
 *     reachable without any Authorization header.
 */
describe('e2e: deny-by-default (Section 10.x, BE-TEST-03)', () => {
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

  it('refuses GET /organizations/:id/members without a Bearer token with 401 AUTH_INVALID_TOKEN', async () => {
    // Seed enough state to address a real org id — the guard MUST reject
    // before any controller/service runs, so the org's existence is
    // irrelevant, but using a real UUID rules out 400 (bad uuid) as a
    // confounder.
    const alice = await seedUserAndLogin(app, 'alice@e2e.test');
    const orgA = await createOrgAndSwitch(app, alice, 'Org A');

    // No Authorization header at all — JwtAuthGuard's deny-by-default.
    // Hit the route directly via the supertest agent so no Bearer leaks
    // through `authedJson`.
    const res = await handle.http
      .get(`/organizations/${orgA.organizationId}/members`)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(res.body).toMatchObject({
      data: null,
      error: { code: ERROR_CODES.AUTH_INVALID_TOKEN },
    });
  });

  it('refuses GET /organizations/:id/members with a malformed Bearer token with 401', async () => {
    const alice = await seedUserAndLogin(app, 'alice@e2e.test');
    const orgA = await createOrgAndSwitch(app, alice, 'Org A');

    // `not-a-real-jwt` is not three base64url segments — passport-jwt
    // rejects it at parse time.
    const res = await handle.http
      .get(`/organizations/${orgA.organizationId}/members`)
      .set('Authorization', 'Bearer not-a-real-jwt')
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(res.body).toMatchObject({
      data: null,
      error: { code: ERROR_CODES.AUTH_INVALID_TOKEN },
    });
  });

  it('refuses GET /organizations/:id/members with a token signed by a different secret with 401', async () => {
    const alice = await seedUserAndLogin(app, 'alice@e2e.test');
    const orgA = await createOrgAndSwitch(app, alice, 'Org A');

    // Structurally a valid JWT, but signed with `wrong-secret` instead
    // of the configured `JWT_ACCESS_SECRET`. The signature verification
    // step inside passport-jwt MUST fail.
    const forged = jwt.sign({ sub: 'fake-user-id' }, 'wrong-secret', { expiresIn: '5m' });

    const res = await handle.http
      .get(`/organizations/${orgA.organizationId}/members`)
      .set('Authorization', `Bearer ${forged}`)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(res.body).toMatchObject({
      data: null,
      error: { code: ERROR_CODES.AUTH_INVALID_TOKEN },
    });
  });

  it('accepts GET /organizations/:id/members with a valid scoped Bearer token with 200', async () => {
    // Happy-path sanity: without this assertion the four 401 cases above
    // could be hiding a broken route. The scoped token carries the
    // `org_id` claim so TenantGuard also passes.
    const alice = await seedUserAndLogin(app, 'alice@e2e.test');
    const orgA = await createOrgAndSwitch(app, alice, 'Org A');

    const res = await authedJson(
      handle.http,
      'get',
      `/organizations/${orgA.organizationId}/members`,
      orgA.scopedAccessToken,
    );

    expect(res.status).toBe(HttpStatus.OK);
  });

  it('allows POST /auth/signup without a Bearer token (route is @Public)', async () => {
    // Sanity of the @Public() opt-out: signup MUST be reachable
    // anonymously, otherwise no one could ever onboard.
    const res = await handle.http
      .post('/auth/signup')
      .set('Content-Type', 'application/json')
      .send({
        email: 'newuser@e2e.test',
        password: 'TestTest2026!',
        firstName: 'New',
        lastName: 'User',
      });

    // Accept any non-3xx/4xx/5xx success — controller may return 200 or
    // 201 depending on framework defaults; what matters is "not 401".
    expect(res.status).toBeLessThan(300);
  });

  it('allows GET /health without a Bearer token (route is @Public)', async () => {
    // Sanity of the @Public() opt-out: health probes MUST be reachable
    // anonymously, otherwise k8s liveness/readiness would 401-loop.
    const res = await handle.http.get('/health');

    expect(res.status).toBe(HttpStatus.OK);
  });
});
