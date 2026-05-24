import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-WF-02 — `workflow_instances` : instance d'un workflow appliqué à un
 * objet métier précis.
 *
 *   - `workflow_definition_id` : FK vers la définition.
 *   - `organization_id`       : tenant scope (lecture filtrée par org).
 *   - `target_type`           : redondant avec la définition pour simplifier
 *     les requêtes de liste sans JOIN (dénormalisation volontaire).
 *   - `target_id`             : UUID de l'objet cible (import_session.id).
 *   - `current_status`        : statut courant (draft | in_review |
 *     approved | locked).  Source de vérité — les events sont le journal.
 *   - `started_by`            : user_id de l'initiateur.
 *   - `started_at`            : timestamp de création de l'instance.
 *   - `completed_at`          : NULL tant que non locked.
 *
 * Contrainte UNIQUE `(organization_id, target_type, target_id)` : une seule
 * instance active de workflow par objet cible et par organisation.  Si un
 * second workflow doit être possible à l'avenir (ex: re-validation après
 * correction), on pourra assouplir ou ajouter un champ `version`.
 */
export class CreateWorkflowInstances1700000000029 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "workflow_instances" (
        "id"                      UUID        NOT NULL DEFAULT gen_random_uuid(),
        "workflow_definition_id"  UUID        NOT NULL,
        "organization_id"         UUID        NOT NULL,
        "target_type"             TEXT        NOT NULL,
        "target_id"               UUID        NOT NULL,
        "current_status"          TEXT        NOT NULL DEFAULT 'draft',
        "started_by"              UUID,
        "started_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
        "completed_at"            TIMESTAMPTZ,
        "updated_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_workflow_instances" PRIMARY KEY ("id"),
        CONSTRAINT "fk_workflow_instances_definition"
          FOREIGN KEY ("workflow_definition_id")
          REFERENCES "workflow_definitions" ("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_workflow_instances_target"
          UNIQUE ("organization_id", "target_type", "target_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_workflow_instances_org_status"
        ON "workflow_instances" ("organization_id", "current_status")
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_workflow_instances_org_target"
        ON "workflow_instances" ("organization_id", "target_type", "target_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_instances"`);
  }
}
