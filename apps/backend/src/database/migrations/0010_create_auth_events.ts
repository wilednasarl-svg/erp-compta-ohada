import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-DB-10 — Initial migration for the `auth_events` table.
 *
 * `auth_events` is the append-only journal of authentication and tenant
 * lifecycle events documented in `specs/auth/spec.md` (Requirement:
 * Authentication events are journaled). Both `user_id` and
 * `organization_id` are nullable: a failed login by an unknown email has
 * no `user_id`, and any event emitted before the user selects an
 * organization has no `organization_id`.
 *
 * `event_type` is kept as `TEXT` without a CHECK constraint so that
 * Module 7 (generic audit log) can extend the catalog without a schema
 * migration. The canonical event codes (e.g. `auth.signup`,
 * `auth.login_failed`, `auth.refresh_token_reuse_detected`,
 * `auth.mfa_verification_failed`, `organizations.role_changed`) are
 * defined in the spec.
 *
 * Indexes are tuned for the three dominant audit-read patterns:
 *   1. per-user timeline ("show the last 50 events for user U").
 *   2. per-organization timeline ("show the last 50 events for org O").
 *   3. per-event-type forensics ("show all `auth.login_failed` in the last
 *      24h").
 * Each index is on `(scope_col, created_at DESC)` so a sort + limit can be
 * served from the index without a heap sort.
 */
export class CreateAuthEvents0010 implements MigrationInterface {
  name = 'CreateAuthEvents0010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `gen_random_uuid()` lives in pgcrypto (enabled by 0001, kept idempotent
    // so this migration can be replayed in isolation).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "auth_events" (
        "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"         UUID         NULL,
        "organization_id" UUID         NULL,
        "event_type"      TEXT         NOT NULL,
        "ip_address"      INET         NULL,
        "user_agent"      TEXT         NULL,
        "metadata"        JSONB        NOT NULL DEFAULT '{}'::jsonb,
        "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_auth_events_user"
          FOREIGN KEY ("user_id")         REFERENCES "users"         ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_auth_events_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "ix_auth_events_user_id_created_at" ON "auth_events" ("user_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_auth_events_organization_id_created_at" ON "auth_events" ("organization_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_auth_events_event_type_created_at" ON "auth_events" ("event_type", "created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_auth_events_event_type_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_auth_events_organization_id_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_auth_events_user_id_created_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "auth_events"`);
  }
}
