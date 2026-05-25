import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Module 3 wave 2 — autoriser 'pdf' comme valeur de
 * `import_sessions.source_type`.
 *
 * Le CHECK constraint posé par 0015_create_import_sessions n'autorise
 * que ('csv', 'excel', 'sage', 'txt'). On le DROP et le re-CREATE
 * avec 'pdf' ajouté. Idempotent côté UP (DROP IF EXISTS) ; le down
 * restore le CHECK original.
 */
export class ExtendImportSourceTypePdf1700000000084 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "import_sessions"
      DROP CONSTRAINT IF EXISTS "chk_import_sessions_source_type";
    `);
    await queryRunner.query(`
      ALTER TABLE "import_sessions"
      ADD CONSTRAINT "chk_import_sessions_source_type"
        CHECK ("source_type" IN ('csv', 'excel', 'sage', 'txt', 'pdf'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restaurer la borne historique. NOTE : si des sessions PDF
    // existent en base au moment du rollback, la contrainte échouera —
    // il faudra d'abord les purger ou les marquer comme un type
    // alternatif (par ex. UPDATE ... SET source_type='csv' WHERE
    // source_type='pdf') AVANT de tourner le down.
    await queryRunner.query(`
      ALTER TABLE "import_sessions"
      DROP CONSTRAINT IF EXISTS "chk_import_sessions_source_type";
    `);
    await queryRunner.query(`
      ALTER TABLE "import_sessions"
      ADD CONSTRAINT "chk_import_sessions_source_type"
        CHECK ("source_type" IN ('csv', 'excel', 'sage', 'txt'));
    `);
  }
}
