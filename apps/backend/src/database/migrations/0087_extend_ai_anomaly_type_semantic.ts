import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-AI-02 — Module 11 wave 2 (LLM provider).
 *
 * Étend la contrainte CHECK `chk_ai_anomalies_type` pour accepter la
 * famille `'semantic_anomaly'` détectée par un provider LLM (Anthropic
 * Claude en wave 2). Conserve les 5 familles heuristiques v1.
 *
 * Migration idempotente : DROP CONSTRAINT IF EXISTS puis ADD.
 */
export class ExtendAiAnomalyTypeSemantic1700000000087 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai_anomalies"
        DROP CONSTRAINT IF EXISTS "chk_ai_anomalies_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "ai_anomalies"
        ADD CONSTRAINT "chk_ai_anomalies_type"
        CHECK ("anomaly_type" IN (
          'extreme_amount',
          'sensitive_account',
          'potential_duplicate',
          'suspicious_date',
          'rare_account_journal',
          'semantic_anomaly'
        ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai_anomalies"
        DROP CONSTRAINT IF EXISTS "chk_ai_anomalies_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "ai_anomalies"
        ADD CONSTRAINT "chk_ai_anomalies_type"
        CHECK ("anomaly_type" IN (
          'extreme_amount',
          'sensitive_account',
          'potential_duplicate',
          'suspicious_date',
          'rare_account_journal'
        ))
    `);
  }
}
