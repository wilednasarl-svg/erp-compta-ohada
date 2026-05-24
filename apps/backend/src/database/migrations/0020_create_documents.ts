import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-DOC-01 — `documents` : central document store for the ERP.
 *
 * Holds every uploaded artifact (invoice scan, contract, bank statement,
 * supporting voucher, …) attached to an organization. Module 10 wave 1
 * delivers the upload / list / preview / soft-delete surface; OCR
 * extraction, S3/Supabase backends and write-back to journal entries
 * arrive in later waves.
 *
 *   - `organization_id` : tenant scope (multi-tenant invariant — every
 *     read MUST filter on it; enforced at the repository layer by
 *     `assertTenantId`).
 *   - `storage_key` : opaque locator used by `DocumentStorageService`
 *     to retrieve the underlying bytes. The default local-FS driver
 *     uses the content-addressed shape `<orgId>/<yyyy>/<mm>/<sha256>.<ext>`,
 *     but the column is generic so an S3 / Supabase Storage adapter
 *     can store its own key shape (e.g. an S3 object key) without a
 *     schema migration.
 *   - `sha256_checksum` : hex-encoded SHA-256 of the file content.
 *     Used to (a) detect intra-org duplicate uploads (the service
 *     warns but allows them — same scan can legitimately back several
 *     vouchers), (b) validate integrity if the file is later migrated
 *     to a different storage backend, (c) drive the
 *     content-addressed key on the local driver.
 *   - `tags` : JSONB array of free-form strings (`["vente", "client-x"]`).
 *     Tag taxonomy is opinionated by the frontend in wave 1; a
 *     dedicated `document_tag_definitions` table can be introduced
 *     later without touching this column (the `?` JSONB operator
 *     supports the planned filter use cases).
 *   - `ocr_status` / `ocr_text` : populated by the wave 2 OCR pipeline.
 *     Wave 1 ships `pending` rows and a `DocumentOcrService` stub that
 *     never advances them — the columns are present so the wave 2
 *     adapter can swap in without a migration.
 *   - `deleted_at` : soft-delete tombstone. The physical file is
 *     retained until a janitor (later wave) reaps storage. List/get
 *     paths filter on `deleted_at IS NULL`; the unique-key indexes
 *     are partial so a re-upload of the same content after soft-delete
 *     is allowed.
 *
 * Indexes
 * -------
 *   - `(organization_id, created_at DESC)` covers the dominant
 *     dashboard read pattern ("latest documents for org X").
 *   - `(organization_id, sha256_checksum)` partial-on-not-deleted
 *     supports the dedup probe at upload time.
 *   - GIN on `tags` powers `WHERE tags ? 'client-x'` filtering.
 */
export class CreateDocuments1700000000020 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "documents" (
        "id"               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"  UUID         NOT NULL,
        "filename"         TEXT         NOT NULL,
        "mime_type"        TEXT         NOT NULL,
        "size_bytes"       BIGINT       NOT NULL,
        "sha256_checksum"  CHAR(64)     NOT NULL,
        "storage_key"      TEXT         NOT NULL,
        "tags"             JSONB        NOT NULL DEFAULT '[]'::jsonb,
        "description"      TEXT         NULL,
        "ocr_status"       TEXT         NOT NULL DEFAULT 'pending',
        "ocr_text"         TEXT         NULL,
        "uploaded_by"      UUID         NOT NULL,
        "uploaded_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "deleted_at"       TIMESTAMPTZ  NULL,
        "deleted_by"       UUID         NULL,
        "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_documents_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_documents_uploaded_by"
          FOREIGN KEY ("uploaded_by") REFERENCES "users" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "fk_documents_deleted_by"
          FOREIGN KEY ("deleted_by") REFERENCES "users" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "chk_documents_size_positive"
          CHECK ("size_bytes" > 0),
        CONSTRAINT "chk_documents_checksum_hex"
          CHECK ("sha256_checksum" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "chk_documents_ocr_status"
          CHECK ("ocr_status" IN ('pending', 'processing', 'processed', 'failed', 'skipped')),
        CONSTRAINT "chk_documents_tags_is_array"
          CHECK (jsonb_typeof("tags") = 'array'),
        CONSTRAINT "chk_documents_deleted_pair"
          CHECK (
            ("deleted_at" IS NULL AND "deleted_by" IS NULL)
            OR ("deleted_at" IS NOT NULL AND "deleted_by" IS NOT NULL)
          )
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "ix_documents_org_created_at"
         ON "documents" ("organization_id", "created_at" DESC)
         WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_documents_org_sha256"
         ON "documents" ("organization_id", "sha256_checksum")
         WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_documents_org_uploaded_by"
         ON "documents" ("organization_id", "uploaded_by")
         WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_documents_org_ocr_status"
         ON "documents" ("organization_id", "ocr_status")
         WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_documents_tags_gin"
         ON "documents" USING gin ("tags" jsonb_path_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_documents_tags_gin"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_documents_org_ocr_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_documents_org_uploaded_by"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_documents_org_sha256"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_documents_org_created_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "documents"`);
  }
}
