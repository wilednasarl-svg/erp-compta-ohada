import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-DB-01 — Initial migration for the `organizations` table.
 *
 * `organizations` is the tenant root of the multi-tenant model (Module 1:
 * auth / organizations / RBAC). Every other tenant-scoped table will FK to
 * `organizations.id`. The `type` column discriminates accounting firms from
 * standalone companies; `deleted_at` enables soft-delete and is indexed for
 * fast "active tenants" filtering.
 */
export class CreateOrganizations1700000000001 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `gen_random_uuid()` lives in pgcrypto (bundled with PostgreSQL >= 13).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "organizations" (
        "id"         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "name"       TEXT         NOT NULL,
        "slug"       TEXT         NOT NULL,
        "type"       TEXT         NOT NULL,
        "created_at" TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ  NULL,
        CONSTRAINT "uq_organizations_slug" UNIQUE ("slug"),
        CONSTRAINT "ck_organizations_type" CHECK ("type" IN ('firm', 'company'))
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "ix_organizations_deleted_at" ON "organizations" ("deleted_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_organizations_deleted_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organizations"`);
  }
}
