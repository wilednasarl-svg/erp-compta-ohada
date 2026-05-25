import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-FX-01 — `currencies` : catalogue par organisation des devises
 * utilisables (ISO 4217, base XOF pour la zone CFA UEMOA).
 *
 * Une org démarre avec un set seedé par `CurrenciesService.seedDefaults`
 * (cf migration 0065). Le `code` est validé par CHECK (3 lettres maj),
 * et UNIQUE par organisation.
 *
 * `decimal_places` reflète l'exposant ISO 4217 minor unit :
 *   - 0 pour XOF, XAF, JPY, KRW… (pas de centimes)
 *   - 2 pour la majorité (EUR, USD, GBP…)
 *   - 3 pour BHD, KWD, OMR, JOD… (millimes / dirhams)
 *
 * Le converter pur (`fx-converter.ts`) lit cette colonne pour arrondir
 * correctement le résultat de la conversion (un EUR → XOF ne doit
 * jamais ressortir avec des centimes : un XOF n'a pas de centimes).
 */
export class CreateCurrencies1700000000063 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "currencies" (
        "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"  UUID         NOT NULL,
        "code"             TEXT         NOT NULL,
        "label"            TEXT         NOT NULL,
        "decimal_places"   SMALLINT     NOT NULL DEFAULT 2,
        "symbol"           TEXT,
        "is_active"        BOOLEAN      NOT NULL DEFAULT TRUE,
        "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_currencies" PRIMARY KEY ("id"),
        CONSTRAINT "fk_currencies_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_currencies_org_code"
          UNIQUE ("organization_id", "code"),
        CONSTRAINT "chk_currencies_code_iso4217"
          CHECK ("code" ~ '^[A-Z]{3}$'),
        CONSTRAINT "chk_currencies_decimal_places"
          CHECK ("decimal_places" IN (0, 2, 3))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_currencies_org_active"
        ON "currencies" ("organization_id", "is_active")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "currencies"`);
  }
}
