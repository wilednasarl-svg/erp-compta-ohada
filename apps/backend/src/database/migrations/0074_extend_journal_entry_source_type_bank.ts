import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-BANK-05 — étend `journal_entries.source_type` pour accepter
 * `'bank_reconciliation'`. Utilisé en wave 2 quand on créera des
 * écritures de régularisation depuis le matching (frais, agios).
 *
 * Conserve les valeurs précédentes (cf. migration 0052).
 */
export class ExtendJournalEntrySourceTypeBank1700000000074 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        DROP CONSTRAINT IF EXISTS "chk_journal_entries_source_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        ADD CONSTRAINT "chk_journal_entries_source_type"
        CHECK ("source_type" IN ('manual', 'import', 'depreciation', 'bank_reconciliation'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        DROP CONSTRAINT IF EXISTS "chk_journal_entries_source_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        ADD CONSTRAINT "chk_journal_entries_source_type"
        CHECK ("source_type" IN ('manual', 'import', 'depreciation'))
    `);
  }
}
