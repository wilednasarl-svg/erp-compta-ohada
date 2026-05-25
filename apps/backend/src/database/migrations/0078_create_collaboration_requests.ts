import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-COLLAB-01 — `collaboration_requests` : demandes de justificatifs
 * cabinet ↔ client (Module 21 wave 1).
 *
 * Une demande est créée par un membre du cabinet (`requester_id`) et
 * peut être assignée à un client (`assignee_id` — nullable pour un
 * broadcast). Le champ `status` suit le cycle de vie validé côté
 * service (`CollaborationStatus`).
 *
 * FK lâches vers `journal_entries.id` et `documents.id` (ON DELETE SET NULL)
 * pour permettre l'attachement contextuel à une pièce comptable existante
 * sans empêcher la suppression de cette pièce de fonctionner.
 *
 * Migration idempotente : IF NOT EXISTS partout.
 */
export class CreateCollaborationRequests1700000000078 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "collaboration_requests" (
        "id"                  UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"     UUID         NOT NULL,
        "requester_id"        UUID         NOT NULL,
        "assignee_id"         UUID,
        "status"              TEXT         NOT NULL DEFAULT 'open',
        "title"               TEXT         NOT NULL,
        "description"         TEXT,
        "linked_entry_id"     UUID,
        "linked_document_id"  UUID,
        "due_date"            DATE,
        "completed_at"        TIMESTAMPTZ,
        "completed_by"        UUID,
        "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_collaboration_requests" PRIMARY KEY ("id"),
        CONSTRAINT "fk_collab_requests_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_collab_requests_requester"
          FOREIGN KEY ("requester_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_collab_requests_assignee"
          FOREIGN KEY ("assignee_id")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_collab_requests_completed_by"
          FOREIGN KEY ("completed_by")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_collab_requests_linked_entry"
          FOREIGN KEY ("linked_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_collab_requests_linked_document"
          FOREIGN KEY ("linked_document_id")
          REFERENCES "documents" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_collab_requests_status"
          CHECK ("status" IN ('open', 'in_progress', 'completed', 'cancelled')),
        CONSTRAINT "chk_collab_requests_title_not_blank"
          CHECK (char_length(btrim("title")) > 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_collab_requests_org_status_created"
        ON "collaboration_requests" ("organization_id", "status", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_collab_requests_org_assignee"
        ON "collaboration_requests" ("organization_id", "assignee_id")
        WHERE "assignee_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_collab_requests_org_requester"
        ON "collaboration_requests" ("organization_id", "requester_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_collab_requests_linked_entry"
        ON "collaboration_requests" ("linked_entry_id")
        WHERE "linked_entry_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_collab_requests_linked_document"
        ON "collaboration_requests" ("linked_document_id")
        WHERE "linked_document_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "collaboration_requests"`);
  }
}
