import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-DB-02 — Initial migration for the `users` table.
 *
 * `users` holds authentication identities for the platform (Module 1:
 * auth / organizations / RBAC). Email uses the `citext` type so that
 * `Email@x.com` and `email@x.com` collide on the UNIQUE constraint without
 * forcing the application layer to normalize casing. `password_hash` stores
 * the Argon2/bcrypt digest (never the raw secret). `deleted_at` enables
 * soft-delete; FK links to `organizations` and RBAC tables are deferred to
 * later migrations once those tables exist.
 */
export class CreateUsers1700000000002 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `gen_random_uuid()` lives in pgcrypto (already enabled by 0001 but kept
    // idempotent so the migration is self-contained when replayed in isolation).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    // `citext` provides a case-insensitive text type used for the email column.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "citext"`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "email"         CITEXT       NOT NULL,
        "password_hash" TEXT         NOT NULL,
        "first_name"    TEXT         NULL,
        "last_name"     TEXT         NULL,
        "locale"        TEXT         NOT NULL DEFAULT 'fr-FR',
        "is_active"     BOOLEAN      NOT NULL DEFAULT true,
        "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "deleted_at"    TIMESTAMPTZ  NULL,
        CONSTRAINT "uq_users_email" UNIQUE ("email")
      )
    `);

    await queryRunner.query(`CREATE INDEX "ix_users_deleted_at" ON "users" ("deleted_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_users_deleted_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    // Intentionally do NOT drop the `citext` extension: it may be relied on
    // by tables created in later migrations.
  }
}
