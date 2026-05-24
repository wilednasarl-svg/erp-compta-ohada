import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-WF-01 — `workflow_definitions` : catalogue des types de workflows.
 *
 * Une définition décrit un workflow nommé applicable à un type de cible
 * donné (`target_type`).  Wave 1 : seul `import_session` est supporté.
 * Les définitions sont créées via un seed (0027) — l'API n'expose pas de
 * CRUD sur cette table en wave 1.
 *
 *   - `name`        : libellé humain (ex: "Workflow de validation d'import").
 *   - `description` : description libre.
 *   - `target_type` : discriminant — `import_session` pour la vague 1.
 *   - `is_active`   : soft-disable sans supprimer la définition.
 */
export class CreateWorkflowDefinitions1700000000028 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "workflow_definitions" (
        "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
        "name"        TEXT        NOT NULL,
        "description" TEXT,
        "target_type" TEXT        NOT NULL,
        "is_active"   BOOLEAN     NOT NULL DEFAULT TRUE,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_workflow_definitions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_workflow_definitions_target_type"
        ON "workflow_definitions" ("target_type")
        WHERE "is_active" = TRUE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_definitions"`);
  }
}
