import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * W4.3 — étend les tables `assets` et `depreciation_schedules` pour
 * supporter les méthodes avancées d'amortissement SYSCOHADA (Tome 2
 * chap 4-5, App. 27-32) :
 *
 *   - SOFTY (Sum-Of-The-Years' digits) — décroissant accéléré
 *   - UOP (Units Of Production) — unités d'œuvre
 *   - Amortissements dérogatoires (R34 doctrine) — différence fiscal vs
 *     économique constatée en provisions réglementées (151).
 *
 * Colonnes ajoutées :
 *
 * `assets`
 *   - total_units                   NUMERIC(15,4)  NULL  — UOP : durée
 *     d'usage attendue (heures, km, pièces).
 *   - units_per_year                JSONB          NULL  — UOP : tableau
 *     des unités produites par exercice [u_y1, u_y2, …].
 *   - derogatory_enabled            BOOLEAN        NOT NULL DEFAULT false
 *   - derogatory_fiscal_method      TEXT           NULL  — méthode
 *     fiscale (linear|declining|softy|units_of_production).
 *   - derogatory_fiscal_duration    INT            NULL  — durée fiscale
 *     en mois si différente.
 *   - derogatory_fiscal_declining_rate NUMERIC(6,4) NULL — taux dégressif
 *     fiscal si applicable.
 *
 * `depreciation_schedules`
 *   - economic_amount         NUMERIC(15,2) NULL — dotation économique
 *     (référence comptable) si dérogatoire actif.
 *   - fiscal_amount           NUMERIC(15,2) NULL — dotation fiscale.
 *   - derogatory_dotation     NUMERIC(15,2) NULL — D 851 / C 151 du
 *     palier dérogatoire (différence fiscal > économique).
 *   - derogatory_reprise      NUMERIC(15,2) NULL — D 151 / C 861 (différence
 *     économique > fiscal — extinction de la provision).
 *
 * CHECK constraints :
 *   - `chk_assets_method` étendu pour accepter softy + units_of_production.
 *   - `chk_assets_declining_rate_consistent` adapté (rate seulement
 *     pour `declining`).
 *
 * down() : DROP des nouvelles colonnes + rollback des CHECK constraints
 * (linear/declining seulement).
 */
export class ExtendAssetsForAdvancedDepreciation1700000000104
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── assets : nouvelles colonnes ─────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "assets"
        ADD COLUMN IF NOT EXISTS "total_units"                 NUMERIC(15,4),
        ADD COLUMN IF NOT EXISTS "units_per_year"              JSONB,
        ADD COLUMN IF NOT EXISTS "derogatory_enabled"          BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "derogatory_fiscal_method"    TEXT,
        ADD COLUMN IF NOT EXISTS "derogatory_fiscal_duration"  INTEGER,
        ADD COLUMN IF NOT EXISTS "derogatory_fiscal_declining_rate" NUMERIC(6,4)
    `);

    // ─── assets : étendre le CHECK sur depreciation_method ───────────
    await queryRunner.query(`
      ALTER TABLE "assets"
        DROP CONSTRAINT IF EXISTS "chk_assets_method"
    `);
    await queryRunner.query(`
      ALTER TABLE "assets"
        ADD CONSTRAINT "chk_assets_method"
        CHECK ("depreciation_method" IN (
          'linear', 'declining', 'softy', 'units_of_production'
        ))
    `);

    // ─── assets : declining_rate cohérent uniquement avec declining ──
    await queryRunner.query(`
      ALTER TABLE "assets"
        DROP CONSTRAINT IF EXISTS "chk_assets_declining_rate_consistent"
    `);
    await queryRunner.query(`
      ALTER TABLE "assets"
        ADD CONSTRAINT "chk_assets_declining_rate_consistent"
        CHECK (
          ("depreciation_method" = 'declining' AND "declining_rate" IS NOT NULL
            AND "declining_rate" > 0 AND "declining_rate" < 1)
          OR
          ("depreciation_method" <> 'declining' AND "declining_rate" IS NULL)
        )
    `);

    // ─── assets : CHECK fiscal method whitelist ──────────────────────
    await queryRunner.query(`
      ALTER TABLE "assets"
        ADD CONSTRAINT "chk_assets_derogatory_fiscal_method"
        CHECK (
          "derogatory_fiscal_method" IS NULL
          OR "derogatory_fiscal_method" IN (
            'linear', 'declining', 'softy', 'units_of_production'
          )
        )
    `);

    // ─── assets : cohérence dérogatoire (si enabled, fiscal_method requis) ─
    await queryRunner.query(`
      ALTER TABLE "assets"
        ADD CONSTRAINT "chk_assets_derogatory_consistent"
        CHECK (
          "derogatory_enabled" = false
          OR "derogatory_fiscal_method" IS NOT NULL
        )
    `);

    // ─── depreciation_schedules : nouvelles colonnes ─────────────────
    await queryRunner.query(`
      ALTER TABLE "depreciation_schedules"
        ADD COLUMN IF NOT EXISTS "economic_amount"       NUMERIC(15,2),
        ADD COLUMN IF NOT EXISTS "fiscal_amount"         NUMERIC(15,2),
        ADD COLUMN IF NOT EXISTS "derogatory_dotation"   NUMERIC(15,2),
        ADD COLUMN IF NOT EXISTS "derogatory_reprise"    NUMERIC(15,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // depreciation_schedules
    await queryRunner.query(`
      ALTER TABLE "depreciation_schedules"
        DROP COLUMN IF EXISTS "economic_amount",
        DROP COLUMN IF EXISTS "fiscal_amount",
        DROP COLUMN IF EXISTS "derogatory_dotation",
        DROP COLUMN IF EXISTS "derogatory_reprise"
    `);

    // assets — drop new CHECK constraints
    await queryRunner.query(`
      ALTER TABLE "assets"
        DROP CONSTRAINT IF EXISTS "chk_assets_derogatory_consistent",
        DROP CONSTRAINT IF EXISTS "chk_assets_derogatory_fiscal_method"
    `);

    // restaurer l'ancien CHECK declining_rate (linear|declining)
    await queryRunner.query(`
      ALTER TABLE "assets"
        DROP CONSTRAINT IF EXISTS "chk_assets_declining_rate_consistent"
    `);
    await queryRunner.query(`
      ALTER TABLE "assets"
        ADD CONSTRAINT "chk_assets_declining_rate_consistent"
        CHECK (
          ("depreciation_method" = 'declining' AND "declining_rate" IS NOT NULL
            AND "declining_rate" > 0 AND "declining_rate" < 1)
          OR
          ("depreciation_method" = 'linear' AND "declining_rate" IS NULL)
        )
    `);

    // restaurer l'ancien CHECK method (linear|declining seulement)
    await queryRunner.query(`
      ALTER TABLE "assets"
        DROP CONSTRAINT IF EXISTS "chk_assets_method"
    `);
    await queryRunner.query(`
      ALTER TABLE "assets"
        ADD CONSTRAINT "chk_assets_method"
        CHECK ("depreciation_method" IN ('linear', 'declining'))
    `);

    await queryRunner.query(`
      ALTER TABLE "assets"
        DROP COLUMN IF EXISTS "derogatory_fiscal_declining_rate",
        DROP COLUMN IF EXISTS "derogatory_fiscal_duration",
        DROP COLUMN IF EXISTS "derogatory_fiscal_method",
        DROP COLUMN IF EXISTS "derogatory_enabled",
        DROP COLUMN IF EXISTS "units_per_year",
        DROP COLUMN IF EXISTS "total_units"
    `);
  }
}
