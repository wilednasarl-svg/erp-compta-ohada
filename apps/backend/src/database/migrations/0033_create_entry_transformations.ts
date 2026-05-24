import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-TRF-01 — `entry_transformations` : table centrale du Moteur de
 * Retraitement (Module 4, wave 1).
 *
 * Principe fondamental : une écriture source (`import_staging_entries`)
 * n'est JAMAIS modifiée. Chaque retraitement (reclassement, ajustement,
 * correction…) crée un artefact supplémentaire ici, conservant :
 *
 *   - `source_entry_id` — FK vers l'écriture d'origine (CASCADE on delete
 *     pour ne pas laisser de transformations orphelines si une session
 *     d'import est purgée).
 *   - `type` — nature du retraitement : reclassification, adjustment,
 *     correction, ventilation, grouping.
 *   - `status` — active | cancelled. Le soft-delete permet undo/redo (vague 2)
 *     sans perte d'historique.
 *   - `before_values` / `after_values` — diff sparse (JSONB) : seulement les
 *     champs modifiés, pas la ligne complète. Rend l'audit lisible et le
 *     rollback partiel possible.
 *   - `notes` — raison / annotation libre du comptable.
 *   - `created_by_id` / `cancelled_by_id` / `cancelled_at` — traçabilité
 *     complète actor + timestamp.
 *
 * Index :
 *   - `(organization_id, source_entry_id)` — requête principale : "toutes
 *     les transformations d'une écriture" (getEntryHistory).
 *   - `(organization_id, type, status)` — dashboard : "toutes les
 *     reclassifications actives de cette org".
 *   - `(organization_id, created_at DESC)` — feed chronologique.
 */
export class CreateEntryTransformations1700000000023 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "entry_transformations" (
        "id"               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"  UUID        NOT NULL,
        "source_entry_id"  UUID        NOT NULL,
        "type"             TEXT        NOT NULL,
        "status"           TEXT        NOT NULL DEFAULT 'active',
        "before_values"    JSONB       NOT NULL DEFAULT '{}'::jsonb,
        "after_values"     JSONB       NOT NULL DEFAULT '{}'::jsonb,
        "notes"            TEXT        NULL,
        "created_by_id"    UUID        NOT NULL,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "cancelled_at"     TIMESTAMPTZ NULL,
        "cancelled_by_id"  UUID        NULL,
        "cancel_reason"    TEXT        NULL,

        CONSTRAINT "fk_entry_transformations_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id")
          ON DELETE CASCADE,

        CONSTRAINT "fk_entry_transformations_source_entry"
          FOREIGN KEY ("source_entry_id")
          REFERENCES "import_staging_entries" ("id")
          ON DELETE CASCADE,

        CONSTRAINT "fk_entry_transformations_created_by"
          FOREIGN KEY ("created_by_id")
          REFERENCES "users" ("id")
          ON DELETE RESTRICT,

        CONSTRAINT "fk_entry_transformations_cancelled_by"
          FOREIGN KEY ("cancelled_by_id")
          REFERENCES "users" ("id")
          ON DELETE RESTRICT,

        CONSTRAINT "chk_entry_transformations_type"
          CHECK ("type" IN (
            'reclassification',
            'adjustment',
            'correction',
            'ventilation',
            'grouping'
          )),

        CONSTRAINT "chk_entry_transformations_status"
          CHECK ("status" IN ('active', 'cancelled')),

        CONSTRAINT "chk_entry_transformations_cancelled_consistency"
          CHECK (
            ("status" = 'cancelled') =
            ("cancelled_at" IS NOT NULL AND "cancelled_by_id" IS NOT NULL)
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_entry_transformations_org_source"
        ON "entry_transformations" ("organization_id", "source_entry_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_entry_transformations_org_type_status"
        ON "entry_transformations" ("organization_id", "type", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_entry_transformations_org_created_at"
        ON "entry_transformations" ("organization_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_entry_transformations_org_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_entry_transformations_org_type_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_entry_transformations_org_source"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "entry_transformations"`);
  }
}
