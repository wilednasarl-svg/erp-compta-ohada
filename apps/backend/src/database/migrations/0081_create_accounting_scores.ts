import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-SCORE-01 — `accounting_scores` : score de santé comptable
 * calculé par exercice (Module 20 wave 1).
 *
 * Append-only : chaque recalcul insère une nouvelle ligne. Le score
 * "courant" est le plus récent par (org, exercise). Garder l'historique
 * sert au reporting et à la détection de dérive (wave 2).
 *
 * `breakdown` est JSONB pour rester extensible (wave 2 ajoutera d'autres
 * critères sans migration). `calculated_by` est versionné pour la
 * coexistence heuristique / ML / LLM (`heuristic_v1` → `ml_v1` plus tard).
 *
 * Migration idempotente : IF NOT EXISTS partout.
 */
export class CreateAccountingScores1700000000081 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "accounting_scores" (
        "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"  UUID         NOT NULL,
        "exercise_id"      UUID         NOT NULL,
        "score"            INTEGER      NOT NULL,
        "grade"            TEXT         NOT NULL,
        "breakdown"        JSONB        NOT NULL DEFAULT '{}'::jsonb,
        "calculated_at"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "calculated_by"    TEXT         NOT NULL DEFAULT 'heuristic_v1',
        CONSTRAINT "pk_accounting_scores" PRIMARY KEY ("id"),
        CONSTRAINT "fk_accounting_scores_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_accounting_scores_exercise"
          FOREIGN KEY ("exercise_id")
          REFERENCES "accounting_periods" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_accounting_scores_score"
          CHECK ("score" BETWEEN 0 AND 100),
        CONSTRAINT "chk_accounting_scores_grade"
          CHECK ("grade" IN ('A', 'B', 'C', 'D'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_accounting_scores_org_exercise_calc"
        ON "accounting_scores" ("organization_id", "exercise_id", "calculated_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_accounting_scores_org_calc"
        ON "accounting_scores" ("organization_id", "calculated_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "accounting_scores"`);
  }
}
