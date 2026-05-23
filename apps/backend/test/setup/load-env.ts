/**
 * Loaded by `jest-e2e.json` BEFORE the test framework boots. Sets the
 * variables every e2e suite needs so individual specs don't have to do
 * env juggling.
 *
 *  1. Load `apps/backend/.env.test` if it exists. This is where the
 *     operator pins `TEST_DATABASE_URL` and any non-default secrets.
 *  2. Promote `TEST_DATABASE_URL` to `DATABASE_URL` so the rest of the
 *     application (env.validation, AppDataSource, DatabaseModule) picks
 *     up the test database without needing any test-mode branching.
 *  3. Provide fail-safe defaults for the non-DB secrets so a minimal
 *     `.env.test` (just `TEST_DATABASE_URL=…`) is enough to run the
 *     suite locally.
 *  4. Force `NODE_ENV=test` and `EMAIL_DRY_RUN=true` so a runaway test
 *     can't accidentally hit real SMTP or behave like a prod build.
 */

import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(__dirname, '..', '..', '.env.test');
if (existsSync(envFile)) {
  loadDotenv({ path: envFile, override: false });
}

if (
  typeof process.env.TEST_DATABASE_URL !== 'string' ||
  process.env.TEST_DATABASE_URL.length === 0
) {
  throw new Error(
    'e2e suite requires TEST_DATABASE_URL. Provision a dedicated Postgres ' +
      '(local container, Supabase branch, …) and either export it or write ' +
      'it to apps/backend/.env.test. See docs/integration-tests.md.',
  );
}

// Promote TEST_DATABASE_URL → DATABASE_URL for the runtime. We never
// want to risk a test wiping the dev/prod DB, so we ONLY accept it via
// the test-specific variable name at the entry point.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  // env.validation.ts requires PORT >= 1; pick any valid value — supertest
  // talks to `app.getHttpServer()` directly (no actual listen() call) so
  // this number is never bound to a socket. We pin to 3001 rather than 0
  // to keep the schema valid and the value identical to the dev default.
  PORT: '3001',
  DB_SSL: process.env.TEST_DB_SSL ?? 'false',
  JWT_SECRET: 'e2e-jwt-secret-not-for-production-use-32chars',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
  // 32 bytes of base64-encoded `0x42` repeated. Test-only, NEVER prod.
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 0x42).toString('base64'),
  SMTP_HOST: 'localhost',
  SMTP_PORT: '587',
  SMTP_USER: 'test',
  SMTP_PASS: 'test',
  SMTP_FROM: 'no-reply@erp-compta.test',
  APP_BASE_URL: 'http://localhost:3001',
  EMAIL_DRY_RUN: 'true',
};

for (const [key, value] of Object.entries(defaults)) {
  if (typeof process.env[key] !== 'string' || process.env[key]!.length === 0) {
    process.env[key] = value;
  }
}

// Belt-and-braces: even if the operator set EMAIL_DRY_RUN=false in their
// shell, force-disable for tests. The dev fixture has no SMTP creds.
process.env.EMAIL_DRY_RUN = 'true';
process.env.NODE_ENV = 'test';
