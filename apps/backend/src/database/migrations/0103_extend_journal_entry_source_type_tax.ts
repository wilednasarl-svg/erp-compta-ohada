import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * W4.1 — étend `journal_entries.source_type` pour accepter
 * `'tax_centralization'`, utilisé par `TvaDeclarationsService.centralize`
 * lors de la génération automatique de l'écriture D 443 / C 445x +
 * C 4441 (ou D 4449) post-déclaration.
 *
 * Ajoute aussi `'impairment'` qui était présent dans le type TypeScript
 * (`JournalEntrySourceType`) depuis W3.2 mais absent de la CHECK DB —
 * dette latente repérée en faisant W4.1 et corrigée ici.
 *
 * Conserve les valeurs précédentes (cf. migrations 0052 et 0074).
 */
export class ExtendJournalEntrySourceTypeTax1700000000103 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        DROP CONSTRAINT IF EXISTS "chk_journal_entries_source_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        ADD CONSTRAINT "chk_journal_entries_source_type"
        CHECK ("source_type" IN (
          'manual',
          'import',
          'depreciation',
          'bank_reconciliation',
          'impairment',
          'tax_centralization'
        ))
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
        CHECK ("source_type" IN ('manual', 'import', 'depreciation', 'bank_reconciliation'))
    `);
  }
}
