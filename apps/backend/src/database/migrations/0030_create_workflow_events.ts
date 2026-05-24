import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-WF-03 — `workflow_events` : journal immuable des transitions d'état.
 *
 * Append-only (pas d'UPDATE ni de DELETE).  Chaque ligne = une transition.
 *
 *   - `workflow_instance_id` : FK vers l'instance.
 *   - `from_status`          : état avant la transition (NULL pour la
 *     création de l'instance — événement synthétique `started`).
 *   - `to_status`            : état après la transition.
 *   - `actor_id`             : user_id qui a déclenché la transition.
 *   - `comment`              : commentaire libre optionnel.
 *   - `occurred_at`          : horodatage serveur (DEFAULT now()).
 */
export class CreateWorkflowEvents1700000000030 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "workflow_events" (
        "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
        "workflow_instance_id" UUID        NOT NULL,
        "from_status"          TEXT,
        "to_status"            TEXT        NOT NULL,
        "actor_id"             UUID,
        "comment"              TEXT,
        "occurred_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_workflow_events" PRIMARY KEY ("id"),
        CONSTRAINT "fk_workflow_events_instance"
          FOREIGN KEY ("workflow_instance_id")
          REFERENCES "workflow_instances" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_workflow_events_instance_occurred"
        ON "workflow_events" ("workflow_instance_id", "occurred_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_events"`);
  }
}
