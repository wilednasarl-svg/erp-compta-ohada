import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-BANK-02 — `bank_statements` : en-tête de relevé bancaire importé.
 *
 * `imported_file_hash` (SHA-256) permet l'idempotence : ré-import d'un
 * même fichier → erreur BANK_STATEMENT_DUPLICATE.
 */
export class CreateBankStatements1700000000071 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bank_statements" (
        "id"                    UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"       UUID         NOT NULL,
        "bank_account_id"       UUID         NOT NULL,
        "period_start"          DATE         NOT NULL,
        "period_end"            DATE         NOT NULL,
        "opening_balance"       NUMERIC(15,2) NOT NULL,
        "closing_balance"       NUMERIC(15,2) NOT NULL,
        "currency"              TEXT         NOT NULL DEFAULT 'XOF',
        "imported_file_name"    TEXT         NOT NULL,
        "imported_file_hash"    TEXT         NOT NULL,
        "imported_lines_count"  INTEGER      NOT NULL DEFAULT 0,
        "matched_lines_count"   INTEGER      NOT NULL DEFAULT 0,
        "status"                TEXT         NOT NULL DEFAULT 'imported',
        "imported_by_id"        UUID,
        "imported_at"           TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "created_at"            TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_bank_statements" PRIMARY KEY ("id"),
        CONSTRAINT "fk_bank_statements_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_bank_statements_bank_account"
          FOREIGN KEY ("bank_account_id")
          REFERENCES "bank_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_bank_statements_org_hash"
          UNIQUE ("organization_id", "bank_account_id", "imported_file_hash"),
        CONSTRAINT "chk_bank_statements_status"
          CHECK ("status" IN ('imported', 'matching', 'reconciled')),
        CONSTRAINT "chk_bank_statements_period_ordered"
          CHECK ("period_end" >= "period_start"),
        CONSTRAINT "chk_bank_statements_matched_lte_total"
          CHECK ("matched_lines_count" >= 0
                 AND "matched_lines_count" <= "imported_lines_count")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_bank_statements_org_account_period"
        ON "bank_statements" ("organization_id", "bank_account_id", "period_end" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_bank_statements_org_status"
        ON "bank_statements" ("organization_id", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "bank_statements"`);
  }
}
