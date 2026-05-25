import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-BANK-05 — Module 15 wave 2.
 *
 * Bank reconciliation N:M + multi-devises :
 *   - Drop l'unique `uq_brm_statement_entry_line` (qui interdisait
 *     plusieurs lignes d'écriture pour une même ligne de relevé).
 *   - Recrée un index NON-unique `ix_brm_stline_entryline` sur les
 *     mêmes colonnes pour conserver les perfs de lookup.
 *   - Ajoute `match_group_id UUID NULL` + index pour grouper les
 *     matches 1:N (toutes les rows d'un même groupe partagent le
 *     même UUID — permet l'unmatch atomique du groupe complet).
 *   - Ajoute `fx_rate_applied NUMERIC(20,10) NULL` pour stocker le
 *     taux de change appliqué lorsque la devise du compte bancaire
 *     diffère de la devise comptable.
 */
export class BankReconciliationNToMFx1700000000088 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bank_reconciliation_matches"
        DROP CONSTRAINT IF EXISTS "uq_brm_statement_entry_line"
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_brm_stline_entryline"
        ON "bank_reconciliation_matches" ("bank_statement_line_id", "journal_entry_line_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "bank_reconciliation_matches"
        ADD COLUMN IF NOT EXISTS "match_group_id" UUID NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_brm_match_group_id"
        ON "bank_reconciliation_matches" ("match_group_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "bank_reconciliation_matches"
        ADD COLUMN IF NOT EXISTS "fx_rate_applied" NUMERIC(20,10) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bank_reconciliation_matches"
        DROP COLUMN IF EXISTS "fx_rate_applied"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_brm_match_group_id"`);
    await queryRunner.query(`
      ALTER TABLE "bank_reconciliation_matches"
        DROP COLUMN IF EXISTS "match_group_id"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_brm_stline_entryline"`);
    await queryRunner.query(`
      ALTER TABLE "bank_reconciliation_matches"
        ADD CONSTRAINT "uq_brm_statement_entry_line"
        UNIQUE ("bank_statement_line_id", "journal_entry_line_id")
    `);
  }
}
