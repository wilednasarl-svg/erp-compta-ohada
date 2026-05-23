import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-DB-03 — Initial migration for the `roles` table and seed of the six
 * system roles defined in `specs/rbac/spec.md`.
 *
 * Roles are the catalog backing the RBAC matrix (Module 1: auth /
 * organizations / RBAC). The six rows seeded here are flagged
 * `is_system = true` and must never be deleted by the application —
 * deletion is therefore guarded by a CHECK in later migrations and by the
 * service layer. `code` is the stable machine identifier consumed by
 * permission checks; `name` and `description` are display values.
 */
export class CreateRoles0003 implements MigrationInterface {
  name = 'CreateRoles0003';

  private static readonly SYSTEM_ROLE_CODES = [
    'admin',
    'expert_comptable',
    'chef_mission',
    'comptable',
    'auditeur',
    'client_readonly',
  ] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `gen_random_uuid()` lives in pgcrypto (already enabled by 0001 but kept
    // idempotent so the migration is self-contained when replayed in isolation).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id"          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
        "code"        TEXT    NOT NULL,
        "name"        TEXT    NOT NULL,
        "description" TEXT    NULL,
        "is_system"   BOOLEAN NOT NULL DEFAULT true,
        CONSTRAINT "uq_roles_code" UNIQUE ("code")
      )
    `);

    // Seed the six system roles. Inserts are idempotent via ON CONFLICT so a
    // partially-applied migration can be replayed without breaking on the
    // UNIQUE("code") constraint.
    await queryRunner.query(
      `
      INSERT INTO "roles" ("code", "name", "description", "is_system") VALUES
        ('admin',            'Administrateur',       'Administrateur de la plateforme avec accès complet.',          true),
        ('expert_comptable', 'Expert-comptable',     'Expert-comptable responsable des dossiers clients du cabinet.', true),
        ('chef_mission',     'Chef de mission',      'Chef de mission supervisant les comptables sur une mission.',   true),
        ('comptable',        'Comptable',            'Comptable opérationnel intervenant sur les dossiers assignés.', true),
        ('auditeur',         'Auditeur',             'Auditeur en lecture sur les dossiers pour contrôle/revue.',     true),
        ('client_readonly',  'Client (lecture seule)', 'Client final disposant d''un accès en lecture seule.',        true)
      ON CONFLICT ("code") DO NOTHING
      `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Delete the six seeded rows explicitly first so the intent of the down()
    // step matches the up() step (create + insert ↔ delete + drop). The
    // subsequent DROP TABLE would also remove them, but the explicit DELETE
    // keeps the migration symmetrical and audit-friendly.
    await queryRunner.query(`DELETE FROM "roles" WHERE "code" = ANY($1)`, [
      [...CreateRoles0003.SYSTEM_ROLE_CODES],
    ]);

    await queryRunner.query(`DROP TABLE IF EXISTS "roles"`);
  }
}
