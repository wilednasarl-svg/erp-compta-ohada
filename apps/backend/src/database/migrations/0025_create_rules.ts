import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-RULE-01 — `rules` : table centrale du Moteur de Règles (Module 5, wave 1).
 *
 * Une règle encode une intention automatisable du type :
 *   "SI compte LIKE '62%' ET journal = 'BQ' ALORS assign cost_center = 'ADMIN'"
 *
 * Invariants :
 *   - `conditions` et `actions` sont stockés en JSONB (schéma validé au niveau
 *     service, pas en DB) — extensible sans migration pour ajouter de nouveaux
 *     opérateurs ou types d'actions.
 *   - La règle ne modifie JAMAIS directement les écritures sources. L'application
 *     passe toujours par TransformationService (Module 4), qui crée des artefacts
 *     `entry_transformations` traçables.
 *   - `is_active` : seules les règles actives sont évaluées lors d'un `applyRules`.
 *   - `priority` : ordre d'évaluation — règles plus basses appliquées en premier
 *     (0 = plus haute priorité). Permet d'ordonner des règles concurrentes.
 *
 * Index :
 *   - `(organization_id, is_active)` — requête principale : "toutes les règles
 *     actives de l'org".
 *   - `(organization_id, created_at DESC)` — tri chronologique.
 */
export class CreateRules1700000000025 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "rules" (
        "id"              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" UUID        NOT NULL,
        "name"            TEXT        NOT NULL,
        "description"     TEXT        NULL,
        "is_active"       BOOLEAN     NOT NULL DEFAULT true,
        "priority"        INT         NOT NULL DEFAULT 100,
        "conditions"      JSONB       NOT NULL DEFAULT '[]'::jsonb,
        "actions"         JSONB       NOT NULL DEFAULT '[]'::jsonb,
        "created_by_id"   UUID        NOT NULL,
        "updated_by_id"   UUID        NULL,
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),

        CONSTRAINT "fk_rules_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id")
          ON DELETE CASCADE,

        CONSTRAINT "fk_rules_created_by"
          FOREIGN KEY ("created_by_id")
          REFERENCES "users" ("id")
          ON DELETE RESTRICT,

        CONSTRAINT "fk_rules_updated_by"
          FOREIGN KEY ("updated_by_id")
          REFERENCES "users" ("id")
          ON DELETE RESTRICT,

        CONSTRAINT "chk_rules_priority_positive"
          CHECK ("priority" >= 0),

        CONSTRAINT "chk_rules_name_not_empty"
          CHECK (char_length(trim("name")) > 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_rules_org_active"
        ON "rules" ("organization_id", "is_active")
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_rules_org_priority"
        ON "rules" ("organization_id", "priority" ASC)
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_rules_org_created_at"
        ON "rules" ("organization_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_rules_org_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_rules_org_priority"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_rules_org_active"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "rules"`);
  }
}
