import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-BANK-04 — `bank_reconciliation_matches` : liaison M:N entre lignes
 * de relevé et lignes d'écriture comptable.
 *
 * Wave 1 : seulement 1:1 (un match = un statement_line ↔ un entry_line).
 * Table déjà conçue pour 1:N (regroupement) en wave 2.
 *
 * `match_method` : 'auto' | 'manual' | 'imported'.
 * `confidence_score` (0–100) : seulement pour les auto-match.
 */
export class CreateBankReconciliationMatches1700000000073 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bank_reconciliation_matches" (
        "id"                       UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"          UUID         NOT NULL,
        "bank_statement_line_id"   UUID         NOT NULL,
        "journal_entry_line_id"    UUID         NOT NULL,
        "match_method"             TEXT         NOT NULL,
        "confidence_score"         INTEGER,
        "matched_by_id"            UUID,
        "matched_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "created_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_bank_reconciliation_matches" PRIMARY KEY ("id"),
        CONSTRAINT "fk_brm_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_brm_statement_line"
          FOREIGN KEY ("bank_statement_line_id")
          REFERENCES "bank_statement_lines" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_brm_journal_entry_line"
          FOREIGN KEY ("journal_entry_line_id")
          REFERENCES "journal_entry_lines" ("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_brm_statement_entry_line"
          UNIQUE ("bank_statement_line_id", "journal_entry_line_id"),
        CONSTRAINT "chk_brm_match_method"
          CHECK ("match_method" IN ('auto', 'manual', 'imported')),
        CONSTRAINT "chk_brm_confidence_range"
          CHECK ("confidence_score" IS NULL
                 OR ("confidence_score" >= 0 AND "confidence_score" <= 100))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_brm_org_statement_line"
        ON "bank_reconciliation_matches" ("organization_id", "bank_statement_line_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_brm_org_entry_line"
        ON "bank_reconciliation_matches" ("organization_id", "journal_entry_line_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "bank_reconciliation_matches"`);
  }
}
