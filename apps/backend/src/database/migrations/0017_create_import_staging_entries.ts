import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-IMP-03 — `import_staging_entries` : lignes d'import à l'état
 * "staging", avant tout commit dans les tables comptables réelles.
 *
 * Chaque ligne du fichier source produit une ligne staging avec :
 *   - `raw_values` (jsonb) : valeurs brutes telles que parsées depuis
 *     le fichier (header → string). Permet de re-jouer le mapping sans
 *     ré-uploader si le mapping évolue.
 *   - `mapped_values` (jsonb) : valeurs projetées sur le schéma cible
 *     (`account`, `journal`, `date`, `debit`, `credit`, `label`,
 *     `partner`, `currency`). Toutes les valeurs cibles sont
 *     normalisées en `string` ou `null` côté JSON ; les conversions
 *     numériques / date sont faites au moment du commit (Module 4).
 *   - `errors` (jsonb array) : liste de `{ code, message, field? }`
 *     remontées par `ValidationService`. Une ligne avec `errors = []`
 *     est éligible à l'import final.
 *   - `row_number` : numéro de ligne dans le fichier source (1-indexé
 *     en respectant la convention humaine ; header = ligne 0 implicite
 *     ou ligne 1 selon le format). Indispensable pour que la UI
 *     puisse dire "ligne 42 du fichier : compte 4111 introuvable".
 *
 * Volumétrie : un fichier de 50 000 lignes produit 50 000 rows ici.
 * jsonb permet de stocker des valeurs hétérogènes sans schéma rigide
 * et reste indexable si on a besoin de filtrer par erreur plus tard.
 */
export class CreateImportStagingEntries1700000000017 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "import_staging_entries" (
        "id"             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "session_id"     UUID         NOT NULL,
        "file_id"        UUID         NOT NULL,
        "row_number"     INTEGER      NOT NULL,
        "raw_values"     JSONB        NOT NULL DEFAULT '{}'::jsonb,
        "mapped_values"  JSONB        NOT NULL DEFAULT '{}'::jsonb,
        "errors"         JSONB        NOT NULL DEFAULT '[]'::jsonb,
        "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_import_staging_entries_session"
          FOREIGN KEY ("session_id") REFERENCES "import_sessions" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_import_staging_entries_file"
          FOREIGN KEY ("file_id") REFERENCES "import_files" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "chk_import_staging_entries_row_positive"
          CHECK ("row_number" > 0)
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "ix_import_staging_entries_session_row"
         ON "import_staging_entries" ("session_id", "row_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_import_staging_entries_file_row"
         ON "import_staging_entries" ("file_id", "row_number")`,
    );
    // GIN sur errors permet à un futur dashboard de lister vite les
    // lignes qui ont une erreur spécifique (`errors @> '[{"code":"X"}]'`).
    await queryRunner.query(
      `CREATE INDEX "ix_import_staging_entries_errors_gin"
         ON "import_staging_entries" USING GIN ("errors" jsonb_path_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_import_staging_entries_errors_gin"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_import_staging_entries_file_row"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_import_staging_entries_session_row"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "import_staging_entries"`);
  }
}
