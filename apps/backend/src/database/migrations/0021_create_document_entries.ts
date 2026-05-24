import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-DOC-01 — `document_entries` : n-n pivot between a document and the
 * journal entries (écritures comptables) it backs.
 *
 *   - `document_id` : FK CASCADE — when a document is hard-deleted the
 *     pivot rows go with it. Soft-delete leaves both the document row
 *     and its pivot rows in place (read paths filter on
 *     `documents.deleted_at IS NULL`).
 *   - `organization_id` : DENORMALIZED on purpose. The journal-entry
 *     table arrives with Module 3 vague 2 / Module 4; in the meantime
 *     the pivot needs an organization_id column so the multi-tenant
 *     invariant is still queryable (every read on this table filters
 *     on `organization_id`). When the journal-entry table lands a
 *     follow-up migration will add the FK `(entry_id) REFERENCES
 *     journal_entries(id)`.
 *   - `entry_id` : UUID with no FK yet (see above). The pivot row is
 *     written by `DocumentsService.linkEntries` once the caller knows
 *     the entry id; the service is responsible for asserting that
 *     `entry_id` actually belongs to the same organization until the
 *     FK lands.
 *   - Composite PK on `(document_id, entry_id)` so re-linking the
 *     same pair is a no-op (`ON CONFLICT DO NOTHING`).
 */
export class CreateDocumentEntries1700000000021 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "document_entries" (
        "document_id"     UUID         NOT NULL,
        "entry_id"        UUID         NOT NULL,
        "organization_id" UUID         NOT NULL,
        "created_by"      UUID         NOT NULL,
        "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_document_entries"
          PRIMARY KEY ("document_id", "entry_id"),
        CONSTRAINT "fk_document_entries_document"
          FOREIGN KEY ("document_id") REFERENCES "documents" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_document_entries_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_document_entries_created_by"
          FOREIGN KEY ("created_by") REFERENCES "users" ("id")
          ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "ix_document_entries_org_entry"
         ON "document_entries" ("organization_id", "entry_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_document_entries_org_document"
         ON "document_entries" ("organization_id", "document_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_document_entries_org_document"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_document_entries_org_entry"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "document_entries"`);
  }
}
