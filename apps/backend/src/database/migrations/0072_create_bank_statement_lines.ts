import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-BANK-03 — `bank_statement_lines` : opérations individuelles.
 *
 * Montant signé : positif = crédit en banque (entrée trésorerie),
 * négatif = débit (sortie). `line_order` préserve l'ordre du fichier.
 */
export class CreateBankStatementLines1700000000072 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bank_statement_lines" (
        "id"                  UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"     UUID         NOT NULL,
        "bank_statement_id"   UUID         NOT NULL,
        "bank_account_id"     UUID         NOT NULL,
        "line_order"          INTEGER      NOT NULL,
        "operation_date"      DATE         NOT NULL,
        "value_date"          DATE,
        "label"               TEXT         NOT NULL,
        "bank_reference"      TEXT,
        "amount"              NUMERIC(15,2) NOT NULL,
        "match_status"        TEXT         NOT NULL DEFAULT 'unmatched',
        "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_bank_statement_lines" PRIMARY KEY ("id"),
        CONSTRAINT "fk_bank_statement_lines_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_bank_statement_lines_statement"
          FOREIGN KEY ("bank_statement_id")
          REFERENCES "bank_statements" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_bank_statement_lines_account"
          FOREIGN KEY ("bank_account_id")
          REFERENCES "bank_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_bank_statement_lines_statement_order"
          UNIQUE ("bank_statement_id", "line_order"),
        CONSTRAINT "chk_bank_statement_lines_match_status"
          CHECK ("match_status" IN ('unmatched', 'matched', 'ignored')),
        CONSTRAINT "chk_bank_statement_lines_amount_nonzero"
          CHECK ("amount" <> 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_bank_statement_lines_statement"
        ON "bank_statement_lines" ("bank_statement_id", "line_order")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_bank_statement_lines_org_account_status"
        ON "bank_statement_lines" ("organization_id", "bank_account_id", "match_status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_bank_statement_lines_amount_date"
        ON "bank_statement_lines" ("bank_account_id", "amount", "operation_date")
        WHERE "match_status" = 'unmatched'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "bank_statement_lines"`);
  }
}
