import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-JE-03 — `journal_entries` : en-têtes d'écritures comptables.
 *
 * Une `JournalEntry` est l'en-tête d'une pièce comptable double-partie.
 * Ses lignes (`journal_entry_lines`) portent les montants débit/crédit.
 *
 *   - `entry_number`  : numéro de pièce séquentiel par journal, immutable.
 *     Assigné en transaction via UPDATE atomique de `journals.next_entry_number`.
 *   - `entry_date`    : date comptable (peut différer de created_at).
 *     Détermine la période comptable applicable.
 *   - `description`   : libellé général de l'écriture.
 *   - `reference`     : référence externe optionnelle (n° de facture, BL…).
 *   - `status`        : draft | validated | cancelled. Voir machine d'états
 *     dans `JournalEntryStatus`.
 *   - `cancels_id`    : si cette entry contre-passe une autre, pointe vers
 *     l'original. Self-FK SET NULL pour ne pas casser la lecture si
 *     l'original est purgé (cas extrême GDPR).
 *   - `source_type`   : `manual` | `import` — d'où vient l'écriture.
 *   - `source_import_session_id` : si source=import, pointe la session.
 *
 * Contraintes :
 *   - UNIQUE (organization_id, journal_id, entry_number)
 *   - CHECK status ∈ ('draft','validated','cancelled')
 *   - CHECK source_type ∈ ('manual','import')
 *   - CHECK validated_at coherent avec status
 */
export class CreateJournalEntries1700000000038 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "journal_entries" (
        "id"                          UUID        NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"             UUID        NOT NULL,
        "journal_id"                  UUID        NOT NULL,
        "period_id"                   UUID        NOT NULL,
        "entry_number"                INTEGER     NOT NULL,
        "entry_date"                  DATE        NOT NULL,
        "description"                 TEXT        NOT NULL,
        "reference"                   TEXT,
        "status"                      TEXT        NOT NULL DEFAULT 'draft',
        "cancels_id"                  UUID,
        "source_type"                 TEXT        NOT NULL DEFAULT 'manual',
        "source_import_session_id"    UUID,
        "created_by_id"               UUID,
        "validated_at"                TIMESTAMPTZ,
        "validated_by_id"             UUID,
        "cancelled_at"                TIMESTAMPTZ,
        "cancelled_by_id"             UUID,
        "cancelled_reason"            TEXT,
        "created_at"                  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"                  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_journal_entries" PRIMARY KEY ("id"),
        CONSTRAINT "fk_journal_entries_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_journal_entries_journal"
          FOREIGN KEY ("journal_id")
          REFERENCES "journals" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_journal_entries_period"
          FOREIGN KEY ("period_id")
          REFERENCES "accounting_periods" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_journal_entries_cancels"
          FOREIGN KEY ("cancels_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "uq_journal_entries_org_journal_number"
          UNIQUE ("organization_id", "journal_id", "entry_number"),
        CONSTRAINT "chk_journal_entries_status"
          CHECK ("status" IN ('draft', 'validated', 'cancelled')),
        CONSTRAINT "chk_journal_entries_source_type"
          CHECK ("source_type" IN ('manual', 'import')),
        CONSTRAINT "chk_journal_entries_validated_coherence"
          CHECK (
            ("status" IN ('validated', 'cancelled') AND "validated_at" IS NOT NULL)
            OR ("status" = 'draft' AND "validated_at" IS NULL)
          ),
        CONSTRAINT "chk_journal_entries_cancelled_coherence"
          CHECK (
            ("status" = 'cancelled' AND "cancelled_at" IS NOT NULL)
            OR ("status" <> 'cancelled')
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_journal_entries_org_period"
        ON "journal_entries" ("organization_id", "period_id", "entry_date")
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_journal_entries_org_journal_date"
        ON "journal_entries" ("organization_id", "journal_id", "entry_date" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_journal_entries_org_status"
        ON "journal_entries" ("organization_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_journal_entries_source_import"
        ON "journal_entries" ("source_import_session_id")
        WHERE "source_import_session_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "journal_entries"`);
  }
}
