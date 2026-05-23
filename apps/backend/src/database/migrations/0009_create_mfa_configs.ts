import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-DB-09 — Initial migration for the `mfa_configs` table.
 *
 * `mfa_configs` holds the per-user TOTP configuration (RFC 6238) plus the
 * hashed backup codes (Module 1: auth / organizations / RBAC). The TOTP
 * secret is stored as `BYTEA` after AES-256-GCM encryption (`iv | tag |
 * ciphertext`); the encryption key lives in `MFA_ENCRYPTION_KEY` and is
 * never persisted. Backup codes are hashed with argon2id, stored as a
 * `TEXT[]`, and consumed single-use (the service nulls or rewrites the
 * array at usage time).
 *
 * `enabled` flips from `false` to `true` only after the user confirms a
 * valid 6-digit TOTP code via `POST /auth/mfa/verify` (see
 * `specs/auth/spec.md`, Requirement: MFA TOTP enrollment). `UNIQUE(user_id)`
 * guarantees at most one MFA configuration per user — re-enrollment overwrites
 * the existing row instead of creating a parallel one.
 */
export class CreateMfaConfigs0009 implements MigrationInterface {
  name = 'CreateMfaConfigs0009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `gen_random_uuid()` lives in pgcrypto (enabled by 0001, kept idempotent
    // so this migration can be replayed in isolation).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "mfa_configs" (
        "id"                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"             UUID         NOT NULL,
        "secret_encrypted"    BYTEA        NOT NULL,
        "enabled"             BOOLEAN      NOT NULL DEFAULT false,
        "activated_at"        TIMESTAMPTZ  NULL,
        "backup_codes_hashed" TEXT[]       NOT NULL DEFAULT '{}',
        "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "uq_mfa_configs_user_id" UNIQUE ("user_id"),
        CONSTRAINT "fk_mfa_configs_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "mfa_configs"`);
  }
}
