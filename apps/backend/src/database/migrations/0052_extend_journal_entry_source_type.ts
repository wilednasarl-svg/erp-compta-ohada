import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-IMMO-03 — étend la CHECK sur `journal_entries.source_type` pour
 * accepter la valeur `'depreciation'`, utilisée par
 * `DepreciationService.postPeriod` lorsqu'il crée l'écriture de
 * dotation aux amortissements via `EntriesService.createDraft`.
 *
 * Idempotent via DROP IF EXISTS sur la contrainte existante.
 *
 * Conserve les valeurs existantes (`manual`, `import`) pour ne pas
 * casser les écritures déjà persistées.
 */
export class ExtendJournalEntrySourceType1700000000052 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        DROP CONSTRAINT IF EXISTS "chk_journal_entries_source_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        ADD CONSTRAINT "chk_journal_entries_source_type"
        CHECK ("source_type" IN ('manual', 'import'))
    `);
  }
}
