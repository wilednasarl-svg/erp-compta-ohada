import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-TVA-02 — `tva_declarations` : déclaration TVA mensuelle.
 *
 * Régime du Réel Normal d'Imposition (RNI) — déclaration mensuelle, donc
 * la clef logique est (org, period_year, period_month). Une seule
 * déclaration `calculated` autorisée par mois : la contrainte d'unicité
 * partielle exclut les `cancelled` pour permettre la reprise après
 * annulation.
 *
 * Statuts (machine à états gérée côté service) :
 *   - draft       → créée mais pas encore agrégée
 *   - calculated  → totaux calculés et figés
 *   - cancelled   → annulée (totaux conservés en lecture seule)
 *
 * Tous les totaux sont DECIMAL(15,2). `tva_a_decaisser` et
 * `credit_tva_reportable` sont mutuellement exclusifs (CHECK).
 */
export class CreateTvaDeclarations1700000000047 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tva_declarations" (
        "id"                        UUID          NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"           UUID          NOT NULL,
        "period_year"               INTEGER       NOT NULL,
        "period_month"              INTEGER       NOT NULL,
        "status"                    TEXT          NOT NULL DEFAULT 'draft',
        "tva_collectee_total"       NUMERIC(15,2) NOT NULL DEFAULT 0,
        "tva_deductible_bs_total"   NUMERIC(15,2) NOT NULL DEFAULT 0,
        "tva_deductible_immo_total" NUMERIC(15,2) NOT NULL DEFAULT 0,
        "tva_a_decaisser"           NUMERIC(15,2) NOT NULL DEFAULT 0,
        "credit_tva_reportable"     NUMERIC(15,2) NOT NULL DEFAULT 0,
        "computed_at"               TIMESTAMPTZ,
        "computed_by_id"            UUID,
        "cancelled_at"              TIMESTAMPTZ,
        "cancelled_by_id"           UUID,
        "cancelled_reason"          TEXT,
        "created_at"                TIMESTAMPTZ   NOT NULL DEFAULT now(),
        "updated_at"                TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_tva_declarations" PRIMARY KEY ("id"),
        CONSTRAINT "fk_tva_declarations_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_tva_declarations_status"
          CHECK ("status" IN ('draft', 'calculated', 'cancelled')),
        CONSTRAINT "chk_tva_declarations_period_year"
          CHECK ("period_year" >= 2000 AND "period_year" <= 2200),
        CONSTRAINT "chk_tva_declarations_period_month"
          CHECK ("period_month" >= 1 AND "period_month" <= 12),
        CONSTRAINT "chk_tva_declarations_totals_non_negative"
          CHECK (
            "tva_collectee_total" >= 0
            AND "tva_deductible_bs_total" >= 0
            AND "tva_deductible_immo_total" >= 0
            AND "tva_a_decaisser" >= 0
            AND "credit_tva_reportable" >= 0
          ),
        CONSTRAINT "chk_tva_declarations_mutually_exclusive"
          CHECK (
            "tva_a_decaisser" = 0 OR "credit_tva_reportable" = 0
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_tva_declarations_org_period"
        ON "tva_declarations" ("organization_id", "period_year", "period_month")
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_tva_declarations_org_status"
        ON "tva_declarations" ("organization_id", "status")
    `);

    // Unicité partielle : une seule déclaration non-annulée par mois.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_tva_declarations_org_period_active"
        ON "tva_declarations" ("organization_id", "period_year", "period_month")
        WHERE "status" <> 'cancelled'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tva_declarations"`);
  }
}
