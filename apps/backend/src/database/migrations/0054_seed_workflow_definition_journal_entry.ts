import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Module 14 wave 1 — workflow_definition seed for `journal_entry`.
 *
 * Reuses Module 6 generic workflow engine. A single active definition
 * row is required so `WorkflowService.startWorkflow` can resolve it on
 * the first transition request.
 *
 * Graphe d'états réutilisé sans modification :
 *   draft → in_review → approved → locked
 *   in_review → draft  (reject / send back)
 *   approved  → in_review (rework before sign)
 *
 * Sémantique côté journal entry :
 *   - `draft`     = ecriture créée, en saisie
 *   - `in_review` = soumise au chef de mission
 *   - `approved`  = revue + signée par chef de mission, en attente d'expert-comptable
 *   - `locked`    = signée par expert-comptable + entry passée en `validated`
 *
 * Idempotent via clause WHERE NOT EXISTS.
 */
export class SeedWorkflowDefinitionJournalEntry1700000000054 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "workflow_definitions" ("name", "description", "target_type", "is_active")
      SELECT
        'Approbation et signature d''écriture comptable',
        'Module 14 — workflow d''approbation multi-niveaux pour les écritures journal: preparer → chef_mission → expert_comptable.',
        'journal_entry',
        TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM "workflow_definitions"
        WHERE "target_type" = 'journal_entry' AND "is_active" = TRUE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "workflow_definitions" WHERE "target_type" = 'journal_entry'
    `);
  }
}
