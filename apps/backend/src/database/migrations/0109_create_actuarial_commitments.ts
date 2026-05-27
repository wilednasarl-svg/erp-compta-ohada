import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * E2 — Engagements actuariels retraite & avantages au personnel.
 *
 * Doctrine : Tome 3 N16B + Tome 2 chap. 21. Les engagements de retraite
 * (IFC), médailles du travail et autres avantages postérieurs à l'emploi
 * sont évalués par la « méthode des unités de crédit projetées » (DAP —
 * dette actuarielle projetée). La partie comptabilisée transite par le
 * compte 196 ; la partie hors-bilan doit être mentionnée en Note annexe.
 *
 * `actuarial_commitments` stocke une évaluation actuarielle par type :
 *   - `obligation_amount`     : DAP totale (engagement brut)
 *   - `provisioned_amount`    : partie déjà comptabilisée (compte 196)
 *   - `offBalanceSheetAmount` : calculé en service comme `obligation - provisioned`
 *
 * Choix :
 *   - Pas de generated column (compat Postgres + simplicité tests).
 *   - `discount_rate` / `staff_turnover` / `salary_growth_rate` en
 *     NUMERIC(5,4) (max 0.9999 = 99,99%).
 *   - `valuation_date` indexée (latest-by-type look-ups).
 *   - 3 indexes ciblés : (org,status), (org,commitment_type), (valuation_date).
 *
 * Numéro 0109 alloué (0108 réservé module pledged-assets en parallèle).
 */
export class CreateActuarialCommitments1700000000109 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "actuarial_commitments" (
        "id"                       UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"          UUID         NOT NULL,
        "commitment_type"          TEXT         NOT NULL,
        "label"                    TEXT         NOT NULL,
        "valuation_date"           DATE         NOT NULL,
        "obligation_amount"        NUMERIC(15,2) NOT NULL,
        "provisioned_amount"       NUMERIC(15,2) NOT NULL DEFAULT 0,
        "discount_rate"            NUMERIC(5,4) NOT NULL,
        "mortality_table"          TEXT         NOT NULL,
        "staff_turnover"           NUMERIC(5,4) NULL,
        "salary_growth_rate"       NUMERIC(5,4) NULL,
        "methodology"              TEXT         NOT NULL,
        "actuary_name"             TEXT         NULL,
        "status"                   TEXT         NOT NULL DEFAULT 'active',
        "comment"                  TEXT         NULL,
        "created_by_id"            UUID         NULL,
        "created_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_actuarial_commitments" PRIMARY KEY ("id"),
        CONSTRAINT "fk_actuarial_commitments_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_actuarial_commitments_type"
          CHECK ("commitment_type" IN ('retraite_ifc','medaille_du_travail','preavis_legal','autre')),
        CONSTRAINT "chk_actuarial_commitments_status"
          CHECK ("status" IN ('active','expired','cancelled')),
        CONSTRAINT "chk_actuarial_commitments_obligation_nonneg"
          CHECK ("obligation_amount" >= 0),
        CONSTRAINT "chk_actuarial_commitments_provisioned_nonneg"
          CHECK ("provisioned_amount" >= 0),
        CONSTRAINT "chk_actuarial_commitments_provision_cap"
          CHECK ("provisioned_amount" <= "obligation_amount")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_actuarial_commitments_org_status"
        ON "actuarial_commitments" ("organization_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_actuarial_commitments_org_type"
        ON "actuarial_commitments" ("organization_id", "commitment_type")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_actuarial_commitments_valuation_date"
        ON "actuarial_commitments" ("valuation_date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_actuarial_commitments_valuation_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_actuarial_commitments_org_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_actuarial_commitments_org_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "actuarial_commitments"`);
  }
}
