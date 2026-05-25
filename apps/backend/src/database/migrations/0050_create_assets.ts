import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-IMMO-01 — `assets` : registre des immobilisations SYSCOHADA.
 *
 * Une ligne par immobilisation (corporelle ou incorporelle). Les trois
 * comptes SYSCOHADA qu'elle agite sont matérialisés en FK pour
 * permettre les contrôles d'intégrité (cross-tenant impossible) et la
 * jointure simple côté reporting :
 *
 *   - `asset_account_id`        → compte 21x/22x/23x/24x (immo brute)
 *   - `depreciation_account_id` → compte 28x (cumul amortissements)
 *   - `expense_account_id`      → compte 681x (dotation d'exercice)
 *
 * Toutes les FK référencent `organization_chart_accounts(id)` et ne
 * peuvent pas pointer vers un compte d'une autre organisation : la
 * combinaison `assertTenantId` + l'invariant FK garantit le cloisonnement.
 *
 * Les sommes en `NUMERIC(15,2)` ; CHECK applique les invariants métier
 * (coût > 0, durée > 0, résiduelle < coût, status whitelist…).
 *
 * Pas de soft-delete : un asset cédé/rebut passe en `status='disposed'`
 * via `AssetsService.dispose` et son échéancier pending est purgé.
 */
export class CreateAssets1700000000050 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // IF NOT EXISTS — la table peut déjà exister si l'ancienne
    // migration CreateAssets1700000000046 (renommée en 0050) a tourné
    // sur une instance prod avant le rename. La structure étant
    // identique on est safe à no-op-er ; les CHECK constraints et
    // indexes ci-dessous utilisent aussi IF NOT EXISTS.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "assets" (
        "id"                         UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"            UUID         NOT NULL,
        "code"                       TEXT         NOT NULL,
        "label"                      TEXT         NOT NULL,
        "acquisition_date"           DATE         NOT NULL,
        "put_in_service_date"        DATE         NOT NULL,
        "acquisition_cost"           NUMERIC(15,2) NOT NULL,
        "residual_value"             NUMERIC(15,2) NOT NULL DEFAULT 0,
        "depreciation_method"        TEXT         NOT NULL,
        "duration_months"            INTEGER      NOT NULL,
        "declining_rate"             NUMERIC(6,4),
        "asset_account_id"           UUID         NOT NULL,
        "depreciation_account_id"    UUID         NOT NULL,
        "expense_account_id"         UUID         NOT NULL,
        "status"                     TEXT         NOT NULL DEFAULT 'active',
        "disposal_date"              DATE,
        "disposal_value"             NUMERIC(15,2),
        "created_by_id"              UUID,
        "created_at"                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_assets" PRIMARY KEY ("id"),
        CONSTRAINT "fk_assets_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_assets_asset_account"
          FOREIGN KEY ("asset_account_id")
          REFERENCES "organization_chart_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_assets_depreciation_account"
          FOREIGN KEY ("depreciation_account_id")
          REFERENCES "organization_chart_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_assets_expense_account"
          FOREIGN KEY ("expense_account_id")
          REFERENCES "organization_chart_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_assets_org_code"
          UNIQUE ("organization_id", "code"),
        CONSTRAINT "chk_assets_code_format"
          CHECK ("code" ~ '^[A-Z0-9-]{1,20}$'),
        CONSTRAINT "chk_assets_method"
          CHECK ("depreciation_method" IN ('linear', 'declining')),
        CONSTRAINT "chk_assets_status"
          CHECK ("status" IN ('active', 'fully_depreciated', 'disposed')),
        CONSTRAINT "chk_assets_cost_positive"
          CHECK ("acquisition_cost" > 0),
        CONSTRAINT "chk_assets_duration_positive"
          CHECK ("duration_months" > 0),
        CONSTRAINT "chk_assets_residual_lt_cost"
          CHECK ("residual_value" >= 0 AND "residual_value" < "acquisition_cost"),
        CONSTRAINT "chk_assets_in_service_after_acquisition"
          CHECK ("put_in_service_date" >= "acquisition_date"),
        CONSTRAINT "chk_assets_declining_rate_consistent"
          CHECK (
            ("depreciation_method" = 'declining' AND "declining_rate" IS NOT NULL
              AND "declining_rate" > 0 AND "declining_rate" < 1)
            OR
            ("depreciation_method" = 'linear' AND "declining_rate" IS NULL)
          ),
        CONSTRAINT "chk_assets_disposal_consistent"
          CHECK (
            ("status" = 'disposed' AND "disposal_date" IS NOT NULL)
            OR
            ("status" <> 'disposed' AND "disposal_date" IS NULL AND "disposal_value" IS NULL)
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_assets_org_status"
        ON "assets" ("organization_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_assets_org_asset_account"
        ON "assets" ("organization_id", "asset_account_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "assets"`);
  }
}
