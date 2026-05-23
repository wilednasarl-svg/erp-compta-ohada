import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-DB-04 — Initial migration for the `permissions` table.
 *
 * `permissions` holds the catalog of atomic authorization codes used by the
 * RBAC layer (Module 1: auth / organizations / RBAC). Permissions are never
 * granted directly to users — they are bound to roles via `role_permissions`
 * (see BE-DB-05). Each row exposes a stable, human-readable `code` (e.g.
 * `accounting.write`) which is what controller decorators (`@RequirePermission`)
 * reference. The seed in this migration matches the catalog defined in
 * `specs/rbac/spec.md` (Requirement: Seeded permission catalog).
 */
export class CreatePermissions0004 implements MigrationInterface {
  name = 'CreatePermissions0004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `gen_random_uuid()` lives in pgcrypto (enabled by 0001, kept idempotent
    // so this migration can be replayed in isolation).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "permissions" (
        "id"          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
        "code"        TEXT  NOT NULL,
        "description" TEXT  NOT NULL,
        CONSTRAINT "uq_permissions_code" UNIQUE ("code")
      )
    `);

    // Seed the canonical permission catalog. Codes MUST stay in sync with
    // `specs/rbac/spec.md` because controller decorators reference them
    // verbatim. `ON CONFLICT (code) DO NOTHING` keeps the seed idempotent
    // for replays in dev/test environments.
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('organizations.read',            'Read organization profile and metadata'),
        ('organizations.update',          'Update organization profile and settings'),
        ('organizations.invite',          'Invite new members to the organization'),
        ('organizations.manage_members',  'Manage organization membership (add, remove, change roles)'),
        ('users.manage_roles',            'Assign or change a user''s role within an organization'),
        ('users.suspend',                 'Suspend or reactivate a user account'),
        ('accounting.read',               'Read accounting data (journals, entries, reports)'),
        ('accounting.write',              'Create or modify accounting entries and restatements'),
        ('accounting.validate',           'Validate intermediate accounting steps'),
        ('accounting.sign',               'Final signature on accounting documents (expert-comptable)'),
        ('audit.read',                    'Read audit trail and immutable event log'),
        ('audit.export',                  'Export audit trail and audit reports'),
        ('mfa.manage_self',               'Manage one''s own MFA factors (enroll, rotate, disable)')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the seeded rows first, then drop the table. Restricting the
    // delete to the known codes avoids wiping any application-defined
    // permissions that may have been added on top of the seed.
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "code" IN (
        'organizations.read',
        'organizations.update',
        'organizations.invite',
        'organizations.manage_members',
        'users.manage_roles',
        'users.suspend',
        'accounting.read',
        'accounting.write',
        'accounting.validate',
        'accounting.sign',
        'audit.read',
        'audit.export',
        'mfa.manage_self'
      )
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "permissions"`);
    // Intentionally do NOT drop the `pgcrypto` extension: other tables rely
    // on `gen_random_uuid()`.
  }
}
