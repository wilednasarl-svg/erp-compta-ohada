import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-IMP-W2-2qn#5 — durcissement défense-en-profondeur sur
 * `import_files.mime_type`.
 *
 * Aujourd'hui, le `FileParserService.resolve()` rejette les fichiers
 * dont le MIME / l'extension ne matche aucun driver (CSV / XLSX / Sage).
 * Mais cette garde vit UNIQUEMENT côté code applicatif. Toute insertion
 * directe :
 *   - via un futur job batch qui contournerait le contrôleur,
 *   - via une console SQL (debug ou migration de données),
 *   - via un nouveau driver côté code qui oublierait de re-vérifier,
 * pourrait planter du garbage MIME dans la table → un parser confus
 * en aval, ou (pire) une faille d'usurpation de type côté UI.
 *
 * La CHECK constraint duplique l'allowlist côté DB :
 *   - text/csv, application/csv : CSV standard et legacy IE.
 *   - text/tab-separated-values : TSV.
 *   - text/plain, application/octet-stream : Sage TXT (le navigateur
 *     peut envoyer l'un ou l'autre selon l'OS).
 *   - application/vnd.openxmlformats-officedocument.spreadsheetml.sheet :
 *     XLSX moderne (Office 2007+).
 *   - application/vnd.ms-excel : XLS legacy.
 *
 * Idempotent : `ADD CONSTRAINT IF NOT EXISTS` n'existe pas en PG mais
 * `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object ... END $$` couvre
 * la ré-application après revert/rerun.
 *
 * Une violation de cette CHECK remontera en code Postgres `23514`
 * (check_violation) que `OrmFilter` traduira en erreur applicative
 * générique. Si on veut un message client métier propre on ajoutera
 * une garde explicite avec `IMPORT_UNSUPPORTED_FORMAT` ; mais comme
 * la garde applicative court AVANT la CHECK, en pratique la CHECK ne
 * se déclenchera que sur un chemin contourné (bug ou attaque).
 */
export class HardenImportFilesMimeType1700000000042 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "import_files"
          ADD CONSTRAINT "chk_import_files_mime_type"
          CHECK ("mime_type" IN (
            'text/csv',
            'application/csv',
            'text/tab-separated-values',
            'text/plain',
            'application/octet-stream',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel'
          ));
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "import_files" DROP CONSTRAINT IF EXISTS "chk_import_files_mime_type"
    `);
  }
}
