import type { INestApplication } from '@nestjs/common';
import type { Test } from 'supertest';

import { AuthService } from '../../src/modules/auth/services/auth.service';
import { OrganizationsService } from '../../src/modules/organizations/services/organizations.service';
import type { E2eHttp } from './app';

/**
 * Test-only seed for an authenticated user. Bypasses `POST /auth/signup`
 * → `POST /auth/login` so individual specs don't repeat 20 lines of
 * preamble. Returns the access token, refresh token, and the seeded
 * user/org ids so the spec can compose further calls.
 */
export interface SeededAuthFixture {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
  readonly accessToken: string;
  readonly refreshToken: string;
}

const NO_OP_CONTEXT = { ipAddress: null, userAgent: null };

export async function seedUserAndLogin(
  app: INestApplication,
  email: string,
  password: string = 'TestTest2026!',
): Promise<SeededAuthFixture> {
  const auth = app.get(AuthService);
  await auth.signup({ email, password, firstName: 'E2E', lastName: 'User' }, NO_OP_CONTEXT);
  const login = await auth.login({ email, password }, NO_OP_CONTEXT);
  if (login.mfa_required) {
    throw new Error(`seedUserAndLogin: unexpected MFA challenge for ${email}`);
  }
  return {
    userId: extractSubFromJwt(login.accessToken),
    email,
    password,
    accessToken: login.accessToken,
    refreshToken: login.refreshToken,
  };
}

/**
 * Create an organization owned by the seeded user. Returns the org id +
 * a fresh access token scoped to it (carries `org_id` + `role: admin`
 * claims, ready for tenant-scoped routes).
 */
export interface SeededOrgFixture {
  readonly organizationId: string;
  readonly scopedAccessToken: string;
  readonly scopedRefreshToken: string;
}

export async function createOrgAndSwitch(
  app: INestApplication,
  fixture: SeededAuthFixture,
  name: string,
): Promise<SeededOrgFixture> {
  const orgs = app.get(OrganizationsService);
  const auth = app.get(AuthService);
  const { organization } = await orgs.create(fixture.userId, { name, type: 'firm' }, NO_OP_CONTEXT);
  const switched = await auth.selectOrganization(fixture.userId, organization.id, NO_OP_CONTEXT);
  return {
    organizationId: organization.id,
    scopedAccessToken: switched.accessToken,
    scopedRefreshToken: switched.refreshToken,
  };
}

/**
 * Send a JSON request with a bearer token. Convenience wrapper so specs
 * read like spec language rather than supertest plumbing.
 */
export function authedJson(
  http: E2eHttp,
  method: 'get' | 'post' | 'patch' | 'delete',
  url: string,
  token: string,
): Test {
  return http[method](url)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json');
}

function extractSubFromJwt(token: string): string {
  const [, payload] = token.split('.');
  if (typeof payload !== 'string') {
    throw new Error('Malformed JWT — expected 3 segments');
  }
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
  const decoded = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
    'utf8',
  );
  const claims = JSON.parse(decoded) as { sub?: unknown };
  if (typeof claims.sub !== 'string') {
    throw new Error('JWT payload missing `sub` claim');
  }
  return claims.sub;
}
