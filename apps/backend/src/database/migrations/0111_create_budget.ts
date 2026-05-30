import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Module Budget — socle de données du budget & contrôle budgétaire.
 *
 * Deux tables :
 *
 *   `budget_axes`  : référentiel des axes analytiques (dimensions de
 *                    pilotage). Un axe = un type (centre de coût, projet,
 *                    agence, produit, zone) + un code unique dans l'org.
 *                    `parent_id` (auto-référence) permet la consolidation
 *                    hiérarchique (agence → région → national).
 *
 *   `budget_lines` : la « ligne budgétaire atomique ». Maille la plus fine
 *                    du modèle : Exercice × Période × Compte SYSCOHADA ×
 *                    axes × Type budget × Scénario. Tout le reste
 *                    (consolidation, écarts, KPI) s'obtient par agrégation.
 *
 * Choix de conception :
 *   - UNE seule table de faits + colonne `budget_type` (OPEX/CAPEX/TRESO/RH)
 *     et colonne `scenario` (BI budget initial / BR budget révisé / REAL
 *     réalisé). Le calcul d'écart devient un simple GROUP BY filtré sur le
 *     scénario — pas de table par type de budget (évite la dérive de schéma).
 *   - `period_month` NULL = ligne annuelle ; 1..12 = ligne mensuelle.
 *   - Montants en NUMERIC(18,2) (agrégats consolidés multi-exercices en XOF).
 *   - `exchange_rate` NUMERIC(12,6) + `amount_base` (= amount × taux, calculé
 *     en service) pour la consolidation multi-devises au taux budgétaire figé.
 *   - Clé de dé-duplication via index unique COALESCE (les axes NULL sont
 *     ramenés à un UUID sentinelle pour que PG considère les lignes égales).
 *
 * Numéro 0111 alloué (0110 = dernière migration en place).
 */
export class CreateBudget1700000000111 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Référentiel des axes analytiques ---------------------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "budget_axes" (
        "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"  UUID        NOT NULL,
        "axis_type"        TEXT        NOT NULL,
        "code"             TEXT        NOT NULL,
        "label"            TEXT        NOT NULL,
        "parent_id"        UUID        NULL,
        "is_active"        BOOLEAN     NOT NULL DEFAULT TRUE,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_budget_axes" PRIMARY KEY ("id"),
        CONSTRAINT "fk_budget_axes_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_budget_axes_parent"
          FOREIGN KEY ("parent_id")
          REFERENCES "budget_axes" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_budget_axes_type"
          CHECK ("axis_type" IN ('cost_center','project','agency','product','zone'))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_budget_axes_org_type_code"
        ON "budget_axes" ("organization_id", "axis_type", "code")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_budget_axes_org_type_active"
        ON "budget_axes" ("organization_id", "axis_type", "is_active")
    `);

    // --- Lignes budgétaires (table de faits) ------------------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "budget_lines" (
        "id"                   UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"      UUID         NOT NULL,
        "fiscal_year"          INTEGER      NOT NULL,
        "period_month"         INTEGER      NULL,
        "budget_type"          TEXT         NOT NULL,
        "scenario"             TEXT         NOT NULL DEFAULT 'BI',
        "account_code"         TEXT         NOT NULL,
        "account_label"        TEXT         NULL,
        "cost_center_axis_id"  UUID         NULL,
        "project_axis_id"      UUID         NULL,
        "agency_axis_id"       UUID         NULL,
        "product_axis_id"      UUID         NULL,
        "amount"               NUMERIC(18,2) NOT NULL DEFAULT 0,
        "currency"             TEXT         NOT NULL DEFAULT 'XOF',
        "exchange_rate"        NUMERIC(12,6) NOT NULL DEFAULT 1,
        "amount_base"          NUMERIC(18,2) NOT NULL DEFAULT 0,
        "comment"              TEXT         NULL,
        "hypothesis"           TEXT         NULL,
        "status"               TEXT         NOT NULL DEFAULT 'brouillon',
        "created_by_id"        UUID         NULL,
        "validated_by_id"      UUID         NULL,
        "created_at"           TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_budget_lines" PRIMARY KEY ("id"),
        CONSTRAINT "fk_budget_lines_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_budget_lines_cost_center"
          FOREIGN KEY ("cost_center_axis_id")
          REFERENCES "budget_axes" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_budget_lines_project"
          FOREIGN KEY ("project_axis_id")
          REFERENCES "budget_axes" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_budget_lines_agency"
          FOREIGN KEY ("agency_axis_id")
          REFERENCES "budget_axes" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_budget_lines_product"
          FOREIGN KEY ("product_axis_id")
          REFERENCES "budget_axes" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_budget_lines_type"
          CHECK ("budget_type" IN ('OPEX','CAPEX','TRESO','RH')),
        CONSTRAINT "chk_budget_lines_scenario"
          CHECK ("scenario" IN ('BI','BR','REAL')),
        CONSTRAINT "chk_budget_lines_status"
          CHECK ("status" IN ('brouillon','soumis','valide_n1','valide_daf','verrouille')),
        CONSTRAINT "chk_budget_lines_period"
          CHECK ("period_month" IS NULL OR ("period_month" BETWEEN 1 AND 12)),
        CONSTRAINT "chk_budget_lines_year"
          CHECK ("fiscal_year" BETWEEN 2000 AND 2200),
        CONSTRAINT "chk_budget_lines_rate_positive"
          CHECK ("exchange_rate" > 0)
      )
    `);

    // Clé de dé-duplication : une ligne par couple comptable+analytique+temps
    // pour un scénario donné. COALESCE ramène les axes NULL à un UUID
    // sentinelle (et la période NULL à 0) pour que PG traite les lignes
    // « sans axe » comme égales.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_budget_lines_natural_key"
        ON "budget_lines" (
          "organization_id",
          "fiscal_year",
          COALESCE("period_month", 0),
          "budget_type",
          "scenario",
          "account_code",
          COALESCE("cost_center_axis_id", '00000000-0000-0000-0000-000000000000'),
          COALESCE("project_axis_id",     '00000000-0000-0000-0000-000000000000'),
          COALESCE("agency_axis_id",      '00000000-0000-0000-0000-000000000000'),
          COALESCE("product_axis_id",     '00000000-0000-0000-0000-000000000000')
        )
    `);

    // Index ciblés pour les requêtes d'écart / KPI (agrégations fréquentes).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_budget_lines_org_year_scenario_type"
        ON "budget_lines" ("organization_id", "fiscal_year", "scenario", "budget_type")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_budget_lines_org_year_account"
        ON "budget_lines" ("organization_id", "fiscal_year", "account_code")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_budget_lines_org_cost_center"
        ON "budget_lines" ("organization_id", "cost_center_axis_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_budget_lines_org_project"
        ON "budget_lines" ("organization_id", "project_axis_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_budget_lines_org_project"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_budget_lines_org_cost_center"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_budget_lines_org_year_account"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_budget_lines_org_year_scenario_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_budget_lines_natural_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "budget_lines"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "ix_budget_axes_org_type_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_budget_axes_org_type_code"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "budget_axes"`);
  }
}
