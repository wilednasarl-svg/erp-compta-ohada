import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-DB-05 — Initial migration for the `role_permissions` join table and
 * seed of the default role → permission mappings.
 *
 * `role_permissions` materializes the RBAC matrix (Module 1: auth /
 * organizations / RBAC). Authorization is always derived through
 * `User → Membership(role) → Role → Permission` — no row in this table
 * means no access. The seed below reproduces verbatim the default mapping
 * documented in `specs/rbac/spec.md` (Requirement: Seeded permission
 * catalog) so a fresh install is immediately usable without a separate
 * bootstrap step.
 *
 * Both FKs cascade on delete so removing a role or a permission row keeps
 * the join table consistent; in practice system roles and seeded
 * permissions are never deleted, but the cascade protects ad-hoc rows
 * created by future migrations.
 */
export class CreateRolePermissions1700000000005 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "role_permissions" (
        "role_id"       UUID NOT NULL,
        "permission_id" UUID NOT NULL,
        CONSTRAINT "pk_role_permissions" PRIMARY KEY ("role_id", "permission_id"),
        CONSTRAINT "fk_role_permissions_role"
          FOREIGN KEY ("role_id")       REFERENCES "roles" ("id")       ON DELETE CASCADE,
        CONSTRAINT "fk_role_permissions_permission"
          FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE
      )
    `);

    // Helpful reverse-lookup index: "which roles grant permission X?" is a
    // hot path for permission audits. The PK already covers the
    // (role_id, permission_id) forward lookup.
    await queryRunner.query(
      `CREATE INDEX "ix_role_permissions_permission_id" ON "role_permissions" ("permission_id")`,
    );

    // Seed via subselects on the stable `code` columns so we never hard-code
    // UUIDs. The (role_code, permission_code) VALUES list IS the
    // specification — keep it aligned with `specs/rbac/spec.md`. The
    // INSERT … SELECT … JOIN pattern resolves both codes to UUIDs in one
    // statement; `ON CONFLICT DO NOTHING` keeps the seed idempotent.
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        -- admin: full control over the organization, users, billing, accounting.
        ('admin',            'organizations.read'),
        ('admin',            'organizations.update'),
        ('admin',            'organizations.invite'),
        ('admin',            'organizations.manage_members'),
        ('admin',            'users.manage_roles'),
        ('admin',            'users.suspend'),
        ('admin',            'accounting.read'),
        ('admin',            'accounting.write'),
        ('admin',            'accounting.validate'),
        ('admin',            'accounting.sign'),
        ('admin',            'audit.read'),
        ('admin',            'audit.export'),
        ('admin',            'mfa.manage_self'),

        -- expert_comptable: all except organizations.manage_members (admin-only),
        -- includes accounting.sign.
        ('expert_comptable', 'organizations.read'),
        ('expert_comptable', 'organizations.update'),
        ('expert_comptable', 'organizations.invite'),
        ('expert_comptable', 'users.manage_roles'),
        ('expert_comptable', 'users.suspend'),
        ('expert_comptable', 'accounting.read'),
        ('expert_comptable', 'accounting.write'),
        ('expert_comptable', 'accounting.validate'),
        ('expert_comptable', 'accounting.sign'),
        ('expert_comptable', 'audit.read'),
        ('expert_comptable', 'audit.export'),
        ('expert_comptable', 'mfa.manage_self'),

        -- chef_mission: supervises a client mission, validates intermediate steps.
        ('chef_mission',     'organizations.read'),
        ('chef_mission',     'accounting.read'),
        ('chef_mission',     'accounting.write'),
        ('chef_mission',     'accounting.validate'),
        ('chef_mission',     'audit.read'),
        ('chef_mission',     'mfa.manage_self'),

        -- comptable: data entry and restatements, no validation authority.
        ('comptable',        'organizations.read'),
        ('comptable',        'accounting.read'),
        ('comptable',        'accounting.write'),
        ('comptable',        'mfa.manage_self'),

        -- auditeur: read + comment + export, no write on accounting data.
        ('auditeur',         'organizations.read'),
        ('auditeur',         'accounting.read'),
        ('auditeur',         'audit.read'),
        ('auditeur',         'audit.export'),
        ('auditeur',         'mfa.manage_self'),

        -- client_readonly: read-only access scoped to the client's own dossier.
        ('client_readonly',  'organizations.read'),
        ('client_readonly',  'accounting.read'),
        ('client_readonly',  'mfa.manage_self')
      ) AS m("role_code", "permission_code")
        ON m."role_code" = r."code" AND m."permission_code" = p."code"
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Wipe associations first, then drop the table. The DROP would also
    // discard the rows, but the explicit DELETE keeps up() and down()
    // symmetrical (create + insert ↔ delete + drop) and audit-friendly.
    await queryRunner.query(`DELETE FROM "role_permissions"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_role_permissions_permission_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "role_permissions"`);
  }
}
