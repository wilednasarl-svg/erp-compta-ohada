/**
 * `jest.globalSetup` — runs ONCE before any e2e suite.
 *
 * Hard-resets the test schema then re-applies every migration so each CI
 * run starts from a deterministic state. We use the same `AppDataSource`
 * the application uses at runtime — keeps the schema in lock-step with
 * what `pnpm migration:run` would produce in dev/prod, and surfaces any
 * migration bug as a test failure rather than a silent drift.
 *
 *  1. `load-env.ts` (a `setupFiles` entry on the jest config) already
 *     promoted `TEST_DATABASE_URL` to `DATABASE_URL` BEFORE jest
 *     instantiated this script. By the time we get here, `process.env`
 *     looks exactly like a real boot.
 *  2. `DROP SCHEMA public CASCADE` is brutal but correct — guarantees
 *     no leftover row from a prior failing run skews the new one.
 *  3. `runMigrations()` re-creates every table + seeds the catalogs
 *     (roles, permissions, role_permissions) — read by the auth flow.
 */

import './load-env';
import 'reflect-metadata';

import { AppDataSource } from '../../src/database/data-source';

export default async function globalSetup(): Promise<void> {
  const dsn = process.env.DATABASE_URL ?? '<unset>';
  const masked = dsn.replace(/(:[^:@]+)@/, ':***@');
  const schema = (AppDataSource.options as { schema?: string }).schema ?? 'public';
  // eslint-disable-next-line no-console -- this is an e2e harness, stdout IS the UX
  console.log(`[e2e] resetting test schema "${schema}" on ${masked}`);

  await AppDataSource.initialize();
  try {
    await AppDataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await AppDataSource.query(`CREATE SCHEMA "${schema}"`);
    // pgcrypto / citext are created idempotently by 0001 / 0002. The
    // DROP SCHEMA above also dropped the extensions, but TypeORM
    // migration 0001 re-creates pgcrypto with IF NOT EXISTS so this is
    // fine.
    await AppDataSource.runMigrations({ transaction: 'all' });
    // eslint-disable-next-line no-console
    console.log(`[e2e] schema "${schema}" reset + migrations applied`);
  } finally {
    await AppDataSource.destroy();
  }
}
