import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-RULE-02 — `rule_executions` : traçabilité des exécutions de règles.
 *
 * Chaque appel à `applyRules` ou `simulateRules` crée une ligne ici pour
 * permettre d'expliquer "qui a automatisé quoi, quand" (audit trail règles).
 *
 *   - `mode = 'simulation'` : aucune transformation réelle n'a été appliquée.
 *   - `mode = 'apply'`      : les transformations ont été créées via
 *     TransformationService (Module 4). Les IDs des transformations créées
 *     sont stockés dans `transformation_ids` (JSONB array d'UUIDs).
 *   - `matched_count`       : nombre d'écritures correspondant aux conditions.
 *   - `applied_count`       : nombre d'écritures transformées (= matched si apply,
 *     = 0 si simulation).
 *   - `scope`               : critères de périmètre passés à l'exécution
 *     (journal, période, filtre libre) — JSONB pour rester extensible.
 *   - `error`               : message d'erreur si l'exécution a partiellement
 *     ou totalement échoué (NULL si succès).
 *
 * Index :
 *   - `(organization_id, rule_id, created_at DESC)` — "toutes les exécutions
 *     d'une règle" pour l'historique et le débogage.
 *   - `(organization_id, created_at DESC)` — feed global par org.
 */
export class CreateRuleExecutions1700000000026 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "rule_executions" (
        "id"                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"    UUID        NOT NULL,
        "rule_id"            UUID        NOT NULL,
        "mode"               TEXT        NOT NULL,
        "scope"              JSONB       NOT NULL DEFAULT '{}'::jsonb,
        "matched_count"      INT         NOT NULL DEFAULT 0,
        "applied_count"      INT         NOT NULL DEFAULT 0,
        "transformation_ids" JSONB       NOT NULL DEFAULT '[]'::jsonb,
        "error"              TEXT        NULL,
        "executed_by_id"     UUID        NOT NULL,
        "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),

        CONSTRAINT "fk_rule_executions_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id")
          ON DELETE CASCADE,

        CONSTRAINT "fk_rule_executions_rule"
          FOREIGN KEY ("rule_id")
          REFERENCES "rules" ("id")
          ON DELETE CASCADE,

        CONSTRAINT "fk_rule_executions_executed_by"
          FOREIGN KEY ("executed_by_id")
          REFERENCES "users" ("id")
          ON DELETE RESTRICT,

        CONSTRAINT "chk_rule_executions_mode"
          CHECK ("mode" IN ('simulation', 'apply')),

        CONSTRAINT "chk_rule_executions_counts_positive"
          CHECK ("matched_count" >= 0 AND "applied_count" >= 0),

        CONSTRAINT "chk_rule_executions_applied_lte_matched"
          CHECK ("applied_count" <= "matched_count")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_rule_executions_org_rule_created_at"
        ON "rule_executions" ("organization_id", "rule_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_rule_executions_org_created_at"
        ON "rule_executions" ("organization_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_rule_executions_org_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_rule_executions_org_rule_created_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "rule_executions"`);
  }
}
