/**
 * `jest.globalTeardown` — runs ONCE after all e2e suites finish.
 *
 * Intentionally a no-op for now: the global-setup teardown happens
 * inside the `try/finally` of that file (DataSource.destroy()), and we
 * intentionally LEAVE the test schema populated so a developer can
 * inspect a failing run with `psql` after the fact. CI runs against a
 * fresh DB anyway, so leftover data does no harm.
 *
 * If a future hardening pass wants to wipe between runs, add:
 *
 *   await AppDataSource.initialize();
 *   await AppDataSource.query('DROP SCHEMA IF EXISTS public CASCADE');
 *   await AppDataSource.destroy();
 */

export default async function globalTeardown(): Promise<void> {
  // Intentionally empty — see docblock above.
}
