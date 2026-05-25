import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-FX-02 — `exchange_rates` : journal historique des taux.
 *
 * Convention de stockage : `1 from_currency = rate to_currency`.
 *
 * Append-only par spec : aucune mise à jour ni suppression d'un taux
 * validé. Pour "corriger", on insère un nouveau taux avec la même
 * paire à une `rate_date` ultérieure. L'API
 * `ExchangeRatesService.getRateAtDate` retourne le LAST taux tel que
 * `rate_date <= date`.
 *
 * Unicité (org, from, to, rate_date, source) — on autorise plusieurs
 * sources le même jour (manuel + BCEAO + ECB) ; le `getRateAtDate`
 * applique une priorité explicite (BCEAO > manual > imported > ECB).
 *
 * Bloqué côté DB : from_currency = to_currency (un taux est une
 * conversion entre deux devises distinctes ; les "taux d'identité"
 * sont gérés en mémoire par le converter pur).
 */
export class CreateExchangeRates1700000000064 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "exchange_rates" (
        "id"                  UUID          NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"     UUID          NOT NULL,
        "from_currency_id"    UUID          NOT NULL,
        "to_currency_id"      UUID          NOT NULL,
        "rate_date"           DATE          NOT NULL,
        "rate"                NUMERIC(20,10) NOT NULL,
        "source"              TEXT          NOT NULL DEFAULT 'manual',
        "source_ref"          TEXT,
        "created_by_id"       UUID,
        "created_at"          TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_exchange_rates" PRIMARY KEY ("id"),
        CONSTRAINT "fk_exchange_rates_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_exchange_rates_from"
          FOREIGN KEY ("from_currency_id")
          REFERENCES "currencies" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_exchange_rates_to"
          FOREIGN KEY ("to_currency_id")
          REFERENCES "currencies" ("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_exchange_rates_org_pair_date_source"
          UNIQUE ("organization_id", "from_currency_id", "to_currency_id",
                  "rate_date", "source"),
        CONSTRAINT "chk_exchange_rates_source"
          CHECK ("source" IN ('manual', 'bceao', 'ecb', 'imported')),
        CONSTRAINT "chk_exchange_rates_distinct_currencies"
          CHECK ("from_currency_id" <> "to_currency_id"),
        CONSTRAINT "chk_exchange_rates_rate_positive"
          CHECK ("rate" > 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_exchange_rates_org_pair_date"
        ON "exchange_rates"
        ("organization_id", "from_currency_id", "to_currency_id", "rate_date" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "exchange_rates"`);
  }
}
