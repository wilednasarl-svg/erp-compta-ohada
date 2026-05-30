import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Module Fiscal & Social — socle des déclarations fiscales/sociales (CI).
 *
 *   `fiscal_parameters`   : table PARAMÈTRES des taux à DATE D'EFFET. Tous
 *                           les taux (TVA, IS, IMF, ITS, CNPS, patente, FDFP…)
 *                           sont paramétrables et versionnés par
 *                           `effective_from`/`effective_to` — l'Annexe fiscale
 *                           ivoirienne est révisée chaque année. JAMAIS de
 *                           taux en dur dans le code.
 *
 *   `fiscal_declarations` : déclarations générées (base × taux → montant dû),
 *                           avec échéancier (`due_date`) et statut de dépôt.
 *                           Le décaissement à l'échéance alimente le budget
 *                           de trésorerie (TRESO).
 *
 * `base_kind` décrit COMMENT calculer la base depuis la compta/budget :
 *   turnover           = chiffre d'affaires (classe 7)
 *   accounting_result  = résultat fiscal
 *   salary_gross       = masse salariale brute
 *   salary_capped      = masse salariale plafonnée (CNPS)
 *   vat_net            = TVA collectée − déductible
 *   custom             = saisie manuelle
 *
 * Numéro 0113 alloué (0112 = dernière migration en place).
 */
export class CreateFiscal1700000000113 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Paramètres fiscaux/sociaux (taux versionnés) ---------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fiscal_parameters" (
        "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"    UUID         NOT NULL,
        "tax_code"           TEXT         NOT NULL,
        "label"              TEXT         NOT NULL,
        "declaration_kind"   TEXT         NOT NULL,
        "rate"               NUMERIC(8,4) NOT NULL DEFAULT 0,
        "base_kind"          TEXT         NOT NULL,
        "periodicity"        TEXT         NOT NULL,
        "ceiling"            NUMERIC(18,2) NULL,
        "floor_amount"       NUMERIC(18,2) NULL,
        "due_day"            INTEGER      NOT NULL DEFAULT 15,
        "charge_account"     TEXT         NULL,
        "liability_account"  TEXT         NULL,
        "effective_from"     DATE         NOT NULL,
        "effective_to"       DATE         NULL,
        "is_active"          BOOLEAN      NOT NULL DEFAULT TRUE,
        "notes"              TEXT         NULL,
        "created_at"         TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_fiscal_parameters" PRIMARY KEY ("id"),
        CONSTRAINT "fk_fiscal_parameters_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_fiscal_parameters_kind"
          CHECK ("declaration_kind" IN ('fiscal','social')),
        CONSTRAINT "chk_fiscal_parameters_base"
          CHECK ("base_kind" IN ('turnover','accounting_result','salary_gross','salary_capped','vat_net','custom')),
        CONSTRAINT "chk_fiscal_parameters_periodicity"
          CHECK ("periodicity" IN ('monthly','quarterly','annual')),
        CONSTRAINT "chk_fiscal_parameters_due_day"
          CHECK ("due_day" BETWEEN 1 AND 31),
        CONSTRAINT "chk_fiscal_parameters_rate_nonneg"
          CHECK ("rate" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_fiscal_parameters_org_code_from"
        ON "fiscal_parameters" ("organization_id", "tax_code", "effective_from")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_fiscal_parameters_org_code_active"
        ON "fiscal_parameters" ("organization_id", "tax_code", "is_active")
    `);

    // --- Déclarations fiscales/sociales (échéancier) ----------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fiscal_declarations" (
        "id"                 UUID          NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"    UUID          NOT NULL,
        "tax_code"           TEXT          NOT NULL,
        "label"              TEXT          NULL,
        "period_year"        INTEGER       NOT NULL,
        "period_month"       INTEGER       NULL,
        "base_amount"        NUMERIC(18,2) NOT NULL DEFAULT 0,
        "rate"               NUMERIC(8,4)  NOT NULL DEFAULT 0,
        "amount_due"         NUMERIC(18,2) NOT NULL DEFAULT 0,
        "currency"           TEXT          NOT NULL DEFAULT 'XOF',
        "due_date"           DATE          NOT NULL,
        "status"             TEXT          NOT NULL DEFAULT 'a_deposer',
        "reference"          TEXT          NULL,
        "justificatif_url"   TEXT          NULL,
        "charge_account"     TEXT          NULL,
        "liability_account"  TEXT          NULL,
        "comment"            TEXT          NULL,
        "created_by_id"      UUID          NULL,
        "validated_by_id"    UUID          NULL,
        "created_at"         TIMESTAMPTZ   NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_fiscal_declarations" PRIMARY KEY ("id"),
        CONSTRAINT "fk_fiscal_declarations_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_fiscal_declarations_status"
          CHECK ("status" IN ('a_deposer','depose','paye','annule')),
        CONSTRAINT "chk_fiscal_declarations_period"
          CHECK ("period_month" IS NULL OR ("period_month" BETWEEN 1 AND 12)),
        CONSTRAINT "chk_fiscal_declarations_year"
          CHECK ("period_year" BETWEEN 2000 AND 2200)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_fiscal_declarations_natural_key"
        ON "fiscal_declarations" (
          "organization_id",
          "tax_code",
          "period_year",
          COALESCE("period_month", 0)
        )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_fiscal_declarations_org_status_due"
        ON "fiscal_declarations" ("organization_id", "status", "due_date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_fiscal_declarations_org_year"
        ON "fiscal_declarations" ("organization_id", "period_year")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_fiscal_declarations_org_year"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_fiscal_declarations_org_status_due"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_fiscal_declarations_natural_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fiscal_declarations"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "ix_fiscal_parameters_org_code_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_fiscal_parameters_org_code_from"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fiscal_parameters"`);
  }
}
