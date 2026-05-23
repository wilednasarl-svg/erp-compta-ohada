import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-DB-06 — Initial migration for the `memberships` join table.
 *
 * `memberships` is the spine of the multi-tenant model (Module 1: auth /
 * organizations / RBAC). It binds a `user` to an `organization` with a
 * single `role` and a lifecycle `status` (`active` | `suspended`). All
 * authorization checks walk this row: `User → Membership(role) → Role
 * → Permission`. The `UNIQUE (user_id, organization_id)` constraint
 * enforces "one role per user per org" — promotions/demotions update the
 * existing row instead of inserting a parallel one.
 *
 * No seed: memberships are created at runtime by the signup, invitation,
 * and admin flows once those endpoints land.
 */
export class CreateMemberships0006 implements MigrationInterface {
  name = 'CreateMemberships0006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `gen_random_uuid()` lives in pgcrypto (enabled by 0001, kept idempotent
    // so this migration can be replayed in isolation).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "memberships" (
        "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"         UUID         NOT NULL,
        "organization_id" UUID         NOT NULL,
        "role_id"         UUID         NOT NULL,
        "status"          TEXT         NOT NULL,
        "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "uq_memberships_user_organization"
          UNIQUE ("user_id", "organization_id"),
        CONSTRAINT "ck_memberships_status"
          CHECK ("status" IN ('active', 'suspended')),
        CONSTRAINT "fk_memberships_user"
          FOREIGN KEY ("user_id")         REFERENCES "users"         ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_memberships_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_memberships_role"
          FOREIGN KEY ("role_id")         REFERENCES "roles"         ("id") ON DELETE RESTRICT
      )
    `);

    // Lookup paths:
    //  - by org: tenant-scoped listings ("members of org X").
    //  - by user: per-user dashboards ("orgs I belong to").
    //  - (org, status): hot path for "active members of org X" used by
    //    every tenant-scoped authorization check.
    // The UNIQUE(user_id, organization_id) constraint already covers the
    // (user_id, organization_id) forward lookup, so no separate index there.
    await queryRunner.query(
      `CREATE INDEX "ix_memberships_organization_id" ON "memberships" ("organization_id")`,
    );
    await queryRunner.query(`CREATE INDEX "ix_memberships_user_id" ON "memberships" ("user_id")`);
    await queryRunner.query(
      `CREATE INDEX "ix_memberships_organization_id_status" ON "memberships" ("organization_id", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_memberships_organization_id_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_memberships_user_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_memberships_organization_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "memberships"`);
  }
}
