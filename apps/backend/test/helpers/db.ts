import type { DataSource } from 'typeorm';

/**
 * Tables wiped between tests. We do NOT truncate the seeded catalogs
 * (`roles`, `permissions`, `role_permissions`) — they're populated by
 * migrations 0003-0005 and the auth flow needs them present.
 *
 * Order matters: child tables first to satisfy FK constraints. Equivalent
 * to `TRUNCATE ... RESTART IDENTITY CASCADE` in one shot, but kept
 * explicit so a future schema addition forces a conscious decision about
 * what gets reset.
 */
const TABLES_TO_TRUNCATE = [
  'auth_events',
  'invitations',
  'mfa_configs',
  'refresh_tokens',
  'memberships',
  // Module 2 — explicit even though the CASCADE on `organizations`
  // below would clear them: keeping them in the list makes a future
  // schema reviewer notice the dependency immediately.
  'organization_chart_accounts',
  'organization_accounting_configs',
  'users',
  'organizations',
] as const;

export async function resetTables(dataSource: DataSource): Promise<void> {
  // Single TRUNCATE call — Postgres handles FK ordering with CASCADE.
  const list = TABLES_TO_TRUNCATE.map((t) => `"${t}"`).join(', ');
  await dataSource.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
