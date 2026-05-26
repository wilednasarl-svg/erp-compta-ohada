import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * W3.5 — Régularisations périodiques OHADA (Tome 1, chap. 6 R41–R46).
 *
 * Crée deux tables :
 *
 *   - `regularization_batches` : enveloppe d'un cycle de régularisation
 *     en fin d'exercice. Statut `draft` → `executed` → `reversed`, ou
 *     `cancelled` (uniquement depuis `draft`). `reversal_date` est
 *     calculé côté service = `exercise_end_date + 1 jour`.
 *
 *   - `regularization_entries` : N entrées par batch. `type` discrimine
 *     la sémantique D/C (voir REGULARIZATION_LINE_MAPPING dans
 *     regularization.types.ts).
 *
 * Les FK vers `journal_entries` sont ON DELETE SET NULL pour préserver
 * la trace d'audit du batch si une écriture devait disparaître (cas
 * théorique en SYSCOHADA). La FK vers `regularization_batches` est
 * ON DELETE CASCADE : supprimer un batch `draft` supprime ses entrées.
 *
 * Pas de permissions RBAC dans cette migration : la couche REST sera
 * livrée en wave 2 (controllers + permissions dans une migration
 * dédiée).
 */
export class CreateRegularizations1700000000096 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Table regularization_batches ────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "regularization_batches" (
        "id"                          UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"             UUID         NOT NULL,
        "exercise_end_date"           DATE         NOT NULL,
        "reversal_date"               DATE         NOT NULL,
        "status"                      TEXT         NOT NULL DEFAULT 'draft',
        "executed_at"                 TIMESTAMPTZ,
        "executed_by_id"              UUID,
        "reversed_at"                 TIMESTAMPTZ,
        "reversed_by_id"              UUID,
        "cancelled_at"                TIMESTAMPTZ,
        "journal_entry_id"            UUID,
        "reversal_journal_entry_id"   UUID,
        "label"                       TEXT         NOT NULL DEFAULT '',
        "created_by_id"               UUID,
        "created_at"                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_regularization_batches" PRIMARY KEY ("id"),
        CONSTRAINT "fk_regularization_batches_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_regularization_batches_executed_by"
          FOREIGN KEY ("executed_by_id")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_regularization_batches_reversed_by"
          FOREIGN KEY ("reversed_by_id")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_regularization_batches_created_by"
          FOREIGN KEY ("created_by_id")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_regularization_batches_journal_entry"
          FOREIGN KEY ("journal_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_regularization_batches_reversal_journal_entry"
          FOREIGN KEY ("reversal_journal_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_regularization_batches_status"
          CHECK ("status" IN ('draft', 'executed', 'reversed', 'cancelled'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_regularization_batches_org_status"
        ON "regularization_batches" ("organization_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_regularization_batches_org_exercise"
        ON "regularization_batches" ("organization_id", "exercise_end_date")
    `);

    // ─── Table regularization_entries ────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "regularization_entries" (
        "id"                       UUID         NOT NULL DEFAULT gen_random_uuid(),
        "batch_id"                 UUID         NOT NULL,
        "organization_id"          UUID         NOT NULL,
        "type"                     TEXT         NOT NULL,
        "expense_revenue_account"  TEXT         NOT NULL,
        "regularization_account"   TEXT         NOT NULL,
        "amount"                   NUMERIC(15,2) NOT NULL,
        "tva_amount"               NUMERIC(15,2) NOT NULL DEFAULT 0,
        "label"                    TEXT         NOT NULL DEFAULT '',
        "created_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_regularization_entries" PRIMARY KEY ("id"),
        CONSTRAINT "fk_regularization_entries_batch"
          FOREIGN KEY ("batch_id")
          REFERENCES "regularization_batches" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_regularization_entries_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_regularization_entries_type"
          CHECK ("type" IN (
            'cca', 'pca', 'cap_charge', 'cap_tva', 'par_produit', 'par_tva'
          )),
        CONSTRAINT "chk_regularization_entries_amount_positive"
          CHECK ("amount" > 0),
        CONSTRAINT "chk_regularization_entries_tva_nonneg"
          CHECK ("tva_amount" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_regularization_entries_batch"
        ON "regularization_entries" ("batch_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_regularization_entries_org_type"
        ON "regularization_entries" ("organization_id", "type")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "regularization_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "regularization_batches"`);
  }
}
