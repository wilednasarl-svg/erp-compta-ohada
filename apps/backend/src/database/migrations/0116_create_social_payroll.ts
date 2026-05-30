import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Module Fiscal — paie sociale (bases par salarié).
 *
 * `social_payroll_lines` porte le salaire brut PAR SALARIÉ et PAR MOIS. C'est
 * ce qui permet un calcul EXACT des charges sociales :
 *   - CNPS / FDFP : plafonnement appliqué PAR TÊTE avant agrégation
 *     (Σ min(brut_i, plafond) × taux), pas sur la masse agrégée.
 *   - ITS : barème progressif appliqué PAR TÊTE puis sommé (le progressif
 *     n'est pas additif → l'agrégat est faux).
 *
 * Une ligne = un salarié sur un mois. `employee_ref` est un identifiant libre
 * (matricule / nom) ; pas de table employés dédiée en wave 1.
 *
 * Numéro 0116 alloué (0115 = dernière migration en place).
 */
export class CreateSocialPayroll1700000000116 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_payroll_lines" (
        "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"  UUID         NOT NULL,
        "period_year"      INTEGER      NOT NULL,
        "period_month"     INTEGER      NOT NULL,
        "employee_ref"     TEXT         NOT NULL,
        "gross_salary"     NUMERIC(18,2) NOT NULL DEFAULT 0,
        "created_by_id"    UUID         NULL,
        "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_social_payroll_lines" PRIMARY KEY ("id"),
        CONSTRAINT "fk_social_payroll_lines_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_social_payroll_lines_month"
          CHECK ("period_month" BETWEEN 1 AND 12),
        CONSTRAINT "chk_social_payroll_lines_year"
          CHECK ("period_year" BETWEEN 2000 AND 2200),
        CONSTRAINT "chk_social_payroll_lines_gross_nonneg"
          CHECK ("gross_salary" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_social_payroll_lines_natural_key"
        ON "social_payroll_lines" ("organization_id", "period_year", "period_month", "employee_ref")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_social_payroll_lines_org_period"
        ON "social_payroll_lines" ("organization_id", "period_year", "period_month")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_social_payroll_lines_org_period"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_social_payroll_lines_natural_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_payroll_lines"`);
  }
}
