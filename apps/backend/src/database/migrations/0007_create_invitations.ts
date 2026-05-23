import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-DB-07 — Initial migration for the `invitations` table.
 *
 * `invitations` materializes the "invite a teammate" flow (Module 1: auth /
 * organizations / RBAC). An admin of an organization issues an invitation by
 * email; a single-use token is generated, hashed with SHA-256, and stored in
 * `token_hash`. The plaintext token only ever appears in the outgoing email.
 * `expires_at` is enforced at the application layer (7-day TTL), and the
 * lifecycle is tracked via the `status` enum (`pending` → `accepted` |
 * `expired` | `revoked`).
 *
 * The composite index `(organization_id, email, status)` is the hot path for
 * the "duplicate pending invitation" check called out in
 * `specs/organizations/spec.md` (Requirement: Send invitation to join an
 * organization, Scenario: Duplicate pending invitation for same email).
 */
export class CreateInvitations0007 implements MigrationInterface {
  name = 'CreateInvitations0007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `gen_random_uuid()` lives in pgcrypto (enabled by 0001, kept idempotent
    // so this migration can be replayed in isolation).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    // `citext` is needed for the email column so that invitations match the
    // case-insensitive identity stored on `users.email` (extension already
    // enabled by 0002; CREATE EXTENSION is idempotent).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "citext"`);

    await queryRunner.query(`
      CREATE TABLE "invitations" (
        "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" UUID         NOT NULL,
        "email"           CITEXT       NOT NULL,
        "role_id"         UUID         NOT NULL,
        "token_hash"      TEXT         NOT NULL,
        "status"          TEXT         NOT NULL DEFAULT 'pending',
        "invited_by"      UUID         NOT NULL,
        "expires_at"      TIMESTAMPTZ  NOT NULL,
        "accepted_at"     TIMESTAMPTZ  NULL,
        "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "uq_invitations_token_hash" UNIQUE ("token_hash"),
        CONSTRAINT "ck_invitations_status"
          CHECK ("status" IN ('pending', 'accepted', 'expired', 'revoked')),
        CONSTRAINT "fk_invitations_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_invitations_role"
          FOREIGN KEY ("role_id")         REFERENCES "roles"         ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_invitations_invited_by"
          FOREIGN KEY ("invited_by")      REFERENCES "users"         ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "ix_invitations_organization_id" ON "invitations" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_invitations_token_hash" ON "invitations" ("token_hash")`,
    );
    // Hot path: "is there already a pending invitation for (org, email)?"
    // Used by the duplicate-pending check (specs/organizations).
    await queryRunner.query(
      `CREATE INDEX "ix_invitations_org_email_status" ON "invitations" ("organization_id", "email", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_invitations_org_email_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_invitations_token_hash"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_invitations_organization_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invitations"`);
  }
}
