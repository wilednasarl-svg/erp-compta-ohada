import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-BANK-01 — `bank_accounts` : comptes bancaires de l'organisation.
 *
 * Attaché à un compte du plan SYSCOHADA (typiquement 521x). La FK
 * `chart_account_id` est RESTRICT : on ne peut pas supprimer un compte
 * du plan utilisé comme contrepartie d'un compte bancaire.
 */
export class CreateBankAccounts1700000000070 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bank_accounts" (
        "id"                  UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"     UUID         NOT NULL,
        "code"                TEXT         NOT NULL,
        "label"               TEXT         NOT NULL,
        "bank_name"           TEXT         NOT NULL,
        "account_number"      TEXT,
        "iban"                TEXT,
        "currency"            TEXT         NOT NULL DEFAULT 'XOF',
        "chart_account_id"    UUID         NOT NULL,
        "opening_balance"     NUMERIC(15,2) NOT NULL DEFAULT 0,
        "status"              TEXT         NOT NULL DEFAULT 'active',
        "last_reconciled_at"  TIMESTAMPTZ,
        "created_by_id"       UUID,
        "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_bank_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "fk_bank_accounts_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_bank_accounts_chart_account"
          FOREIGN KEY ("chart_account_id")
          REFERENCES "organization_chart_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_bank_accounts_org_code"
          UNIQUE ("organization_id", "code"),
        CONSTRAINT "chk_bank_accounts_code_format"
          CHECK ("code" ~ '^[A-Z0-9-]{1,20}$'),
        CONSTRAINT "chk_bank_accounts_status"
          CHECK ("status" IN ('active', 'closed')),
        CONSTRAINT "chk_bank_accounts_currency"
          CHECK ("currency" ~ '^[A-Z]{3}$')
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_bank_accounts_org_status"
        ON "bank_accounts" ("organization_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_bank_accounts_org_chart_account"
        ON "bank_accounts" ("organization_id", "chart_account_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "bank_accounts"`);
  }
}
