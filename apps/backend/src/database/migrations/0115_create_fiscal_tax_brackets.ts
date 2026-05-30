import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Module Fiscal — barème progressif par tranches (ITS réforme 2024).
 *
 * `fiscal_tax_brackets` porte un barème progressif versionné par date d'effet,
 * pour les impôts non couverts par un taux plat (ITS sur salaires). Chaque
 * tranche : [from_amount, to_amount) × rate ; `to_amount` NULL = tranche
 * supérieure ouverte (∞). L'impôt = Σ sur les tranches de
 * (min(base, to) − from) × rate pour les tranches où base > from.
 *
 * Réutilise le code d'impôt (`tax_code`) de `fiscal_parameters` : un impôt à
 * barème a un paramètre (périodicité, comptes, due_day) + un jeu de tranches.
 *
 * Numéro 0115 alloué (0114 = dernière migration en place).
 */
export class CreateFiscalTaxBrackets1700000000115 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fiscal_tax_brackets" (
        "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"  UUID         NOT NULL,
        "tax_code"         TEXT         NOT NULL,
        "effective_from"   DATE         NOT NULL,
        "bracket_order"    INTEGER      NOT NULL,
        "from_amount"      NUMERIC(18,2) NOT NULL,
        "to_amount"        NUMERIC(18,2) NULL,
        "rate"             NUMERIC(8,4) NOT NULL,
        "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_fiscal_tax_brackets" PRIMARY KEY ("id"),
        CONSTRAINT "fk_fiscal_tax_brackets_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_fiscal_tax_brackets_rate_nonneg"
          CHECK ("rate" >= 0),
        CONSTRAINT "chk_fiscal_tax_brackets_bounds"
          CHECK ("to_amount" IS NULL OR "to_amount" > "from_amount"),
        CONSTRAINT "chk_fiscal_tax_brackets_from_nonneg"
          CHECK ("from_amount" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_fiscal_tax_brackets_order"
        ON "fiscal_tax_brackets" ("organization_id", "tax_code", "effective_from", "bracket_order")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_fiscal_tax_brackets_org_code_from"
        ON "fiscal_tax_brackets" ("organization_id", "tax_code", "effective_from")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_fiscal_tax_brackets_org_code_from"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_fiscal_tax_brackets_order"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fiscal_tax_brackets"`);
  }
}
