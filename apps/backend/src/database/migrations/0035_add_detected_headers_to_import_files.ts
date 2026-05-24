import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 0035 — add `detected_headers` JSONB column to `import_files`.
 *
 * Fix projet-ferme-7lr: `preview()` was re-opening and re-parsing the
 * entire file just to recover the canonical header list. Persisting
 * headers at parse time eliminates this redundant I/O and also plugs
 * a file-descriptor leak on crash mid-drain.
 */
export class AddDetectedHeadersToImportFiles1716580000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE import_files
        ADD COLUMN detected_headers jsonb DEFAULT NULL;
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN import_files.detected_headers
        IS 'Canonical header list detected during parsing (ordered JSON array of strings). NULL until the file is successfully parsed.';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE import_files
        DROP COLUMN IF EXISTS detected_headers;
    `);
  }
}
