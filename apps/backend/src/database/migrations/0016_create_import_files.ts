import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-IMP-02 — `import_files` : un fichier physique uploadé dans une
 * session d'import.
 *
 *   - `session_id` : FK CASCADE — supprimer la session purge ses
 *     fichiers (et leurs lignes staging via FK CASCADE de niveau
 *     supérieur).
 *   - `storage_path` : chemin relatif au répertoire racine de stockage
 *     (`IMPORT_STORAGE_DIR` env, default `./uploads`). On stocke un
 *     chemin RELATIF pour que la portabilité entre instances Railway
 *     soit possible si on bouge le volume.
 *   - `sha256_checksum` : empreinte du contenu uploadé. Sert à
 *     (a) détecter les doublons exacts si un user uploade 2x le même
 *     fichier dans des sessions différentes, (b) valider l'intégrité
 *     si on déplace le fichier vers du stockage objet plus tard.
 *   - `status` : indication du parsing — `uploaded` au PUT, `parsing`
 *     pendant le preview, `parsed` après succès, `parse_failed` si le
 *     parser a remonté une erreur fatale.
 *
 * MVP : un seul fichier par session côté contraintes applicatives, mais
 * le schéma autorise plusieurs (1:N) pour ne pas bloquer un futur
 * use-case multi-fichiers (ex. balance + grand-livre en parallèle).
 */
export class CreateImportFiles1700000000016 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "import_files" (
        "id"               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "session_id"       UUID         NOT NULL,
        "original_name"    TEXT         NOT NULL,
        "mime_type"        TEXT         NOT NULL,
        "size_bytes"       BIGINT       NOT NULL,
        "sha256_checksum"  CHAR(64)     NOT NULL,
        "storage_path"     TEXT         NOT NULL,
        "status"           TEXT         NOT NULL DEFAULT 'uploaded',
        "parse_error"      TEXT         NULL,
        "uploaded_by"      UUID         NOT NULL,
        "uploaded_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_import_files_session"
          FOREIGN KEY ("session_id") REFERENCES "import_sessions" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_import_files_uploaded_by"
          FOREIGN KEY ("uploaded_by") REFERENCES "users" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "chk_import_files_status"
          CHECK ("status" IN ('uploaded', 'parsing', 'parsed', 'parse_failed')),
        CONSTRAINT "chk_import_files_size_positive"
          CHECK ("size_bytes" > 0),
        CONSTRAINT "chk_import_files_checksum_hex"
          CHECK ("sha256_checksum" ~ '^[0-9a-f]{64}$')
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "ix_import_files_session" ON "import_files" ("session_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_import_files_session_checksum"
         ON "import_files" ("session_id", "sha256_checksum")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_import_files_session_checksum"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_import_files_session"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "import_files"`);
  }
}
