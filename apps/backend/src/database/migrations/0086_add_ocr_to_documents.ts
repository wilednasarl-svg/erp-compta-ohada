import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Module 10 wave 2 — extend `documents` with OCR + extracted metadata.
 *
 *   - `ocr_confidence`     : average confidence reported by the OCR
 *                             engine in [0, 1]. CHECK guards the range.
 *   - `ocr_processed_at`   : timestamp of the OCR run (audit trail).
 *   - `extracted_metadata` : JSONB blob with invoice metadata derived
 *                             from `ocr_text` by the regex-based
 *                             `MetadataExtractor`. Schema is fluid in
 *                             wave 2 — stored as JSONB so wave 3 (LLM
 *                             extractor) can add fields without a
 *                             migration.
 *
 * `ocr_text` is already declared in `0020_create_documents.ts` — we
 * only add the three new columns here.
 *
 * Down: drop the 3 new columns. `ocr_text` stays (owned by 0020).
 */
export class AddOcrToDocuments1700000000086 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "documents"
        ADD COLUMN IF NOT EXISTS "ocr_confidence" DECIMAL(3, 2) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "documents"
        DROP CONSTRAINT IF EXISTS "chk_documents_ocr_confidence_range"
    `);
    await queryRunner.query(`
      ALTER TABLE "documents"
        ADD CONSTRAINT "chk_documents_ocr_confidence_range"
        CHECK ("ocr_confidence" IS NULL OR ("ocr_confidence" BETWEEN 0 AND 1))
    `);

    await queryRunner.query(`
      ALTER TABLE "documents"
        ADD COLUMN IF NOT EXISTS "ocr_processed_at" TIMESTAMPTZ NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "documents"
        ADD COLUMN IF NOT EXISTS "extracted_metadata" JSONB NULL
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "documents"."ocr_confidence"
        IS 'Average OCR confidence in [0, 1], NULL until OCR runs.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "documents"."ocr_processed_at"
        IS 'Timestamp of last OCR run (success or failure).'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "documents"."extracted_metadata"
        IS 'Invoice metadata extracted from ocr_text (Module 10 wave 2).'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "documents"
        DROP CONSTRAINT IF EXISTS "chk_documents_ocr_confidence_range"
    `);
    await queryRunner.query(`
      ALTER TABLE "documents"
        DROP COLUMN IF EXISTS "extracted_metadata"
    `);
    await queryRunner.query(`
      ALTER TABLE "documents"
        DROP COLUMN IF EXISTS "ocr_processed_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "documents"
        DROP COLUMN IF EXISTS "ocr_confidence"
    `);
  }
}
