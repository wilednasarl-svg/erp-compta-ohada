import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * d17.27 — Ajout du journal standard `PA` (Paie) au catalogue SYSCOHADA.
 *
 * Étend la contrainte CHECK `chk_journals_kind` créée par la migration 0037
 * pour accepter la valeur `PA` en plus de AC/VE/BQ/CA/OD, puis backfille
 * un journal de Paie par organisation existante (numéro de pièce initialisé
 * à 1, journal actif, sans compte par défaut — la paie touche plusieurs
 * comptes 661x/422/43x/447 selon la nature de la ligne).
 *
 * Les nouvelles organisations créées après cette migration reçoivent
 * automatiquement les 6 journaux via `JournalsService.seedStandardJournals`
 * (boucle sur `STANDARD_JOURNALS`).
 *
 * Idempotence du backfill : `ON CONFLICT DO NOTHING` sur la contrainte
 * unique `uq_journals_org_code` — si une org a déjà un journal PA custom,
 * on ne l'écrase pas.
 */
export class ExtendJournalsKindPayroll1700000000093 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "journals"
        DROP CONSTRAINT IF EXISTS "chk_journals_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "journals"
        ADD CONSTRAINT "chk_journals_kind"
        CHECK ("kind" IN ('AC', 'VE', 'BQ', 'CA', 'OD', 'PA'))
    `);

    await queryRunner.query(`
      INSERT INTO "journals" ("organization_id", "code", "label", "kind")
        SELECT "id", 'PA', 'Journal de Paie', 'PA'
          FROM "organizations"
          WHERE "deleted_at" IS NULL
      ON CONFLICT ON CONSTRAINT "uq_journals_org_code" DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "journals"
        WHERE "kind" = 'PA'
          AND "code" = 'PA'
          AND "next_entry_number" = 1
    `);
    await queryRunner.query(`
      ALTER TABLE "journals"
        DROP CONSTRAINT IF EXISTS "chk_journals_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "journals"
        ADD CONSTRAINT "chk_journals_kind"
        CHECK ("kind" IN ('AC', 'VE', 'BQ', 'CA', 'OD'))
    `);
  }
}
