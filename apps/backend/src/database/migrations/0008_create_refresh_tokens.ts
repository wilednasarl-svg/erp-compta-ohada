import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-DB-08 — Initial migration for the `refresh_tokens` table.
 *
 * `refresh_tokens` stores opaque refresh tokens (256-bit random, hashed with
 * SHA-256 in `token_hash`) issued at login and rotated at every `/auth/refresh`
 * call. The plaintext never persists. Two columns enforce the rotation +
 * reuse-detection invariant documented in `specs/auth/spec.md` (Requirement:
 * Refresh token rotation with reuse detection):
 *   - `used_at`     — set when a token is consumed by a rotation.
 *   - `revoked_at`  — set on logout or when a sibling reuse is detected.
 *
 * All tokens issued from the same login share a `family_id` (UUID generated
 * at the first issuance). If a token whose `used_at IS NOT NULL` is replayed,
 * the service revokes the entire family and emits
 * `auth.refresh_token_reuse_detected`.
 *
 * `organization_id` is nullable because the refresh token lives across the
 * "select organization" step: a freshly-logged-in user has a refresh token
 * scoped to no org until they call `POST /auth/select-organization`.
 */
export class CreateRefreshTokens1700000000008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // `gen_random_uuid()` lives in pgcrypto (enabled by 0001, kept idempotent
    // so this migration can be replayed in isolation).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"         UUID         NOT NULL,
        "organization_id" UUID         NULL,
        "token_hash"      TEXT         NOT NULL,
        "family_id"       UUID         NOT NULL,
        "used_at"         TIMESTAMPTZ  NULL,
        "expires_at"      TIMESTAMPTZ  NOT NULL,
        "revoked_at"      TIMESTAMPTZ  NULL,
        "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "uq_refresh_tokens_token_hash" UNIQUE ("token_hash"),
        CONSTRAINT "fk_refresh_tokens_user"
          FOREIGN KEY ("user_id")         REFERENCES "users"         ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_refresh_tokens_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "ix_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_refresh_tokens_family_id" ON "refresh_tokens" ("family_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_refresh_tokens_token_hash" ON "refresh_tokens" ("token_hash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_refresh_tokens_token_hash"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_refresh_tokens_family_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_refresh_tokens_user_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
  }
}
