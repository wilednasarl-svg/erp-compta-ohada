import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-TVA-01 — `tva_codes` : catalogue de codes TVA par organisation.
 *
 * 4 codes TVA standards Côte d'Ivoire seedés à la création d'une org via
 * `TvaCodesService.seedDefaultCodes` (appelé dans la même transaction
 * que `OrganizationsService.create`) :
 *   - TVA-N-18 : taux normal 18%
 *   - TVA-N-09 : taux réduit 9%
 *   - TVA-EXO  : exonérée locale
 *   - TVA-EXP  : export 0%
 *
 * `code` : identifiant scopé tenant (UNIQUE org+code). Format
 *   `^[A-Z0-9-]{1,16}$` (validé côté DTO + check contrainte).
 * `rate` : DECIMAL(5,2) — 0.00 → 99.99.
 * `type` : sales | purchase | both (direction d'application).
 * `kind` : normal | reduced | exempt | exonerated | export (nature fiscale).
 */
export class CreateTvaCodes1700000000046 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tva_codes" (
        "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" UUID         NOT NULL,
        "code"            TEXT         NOT NULL,
        "label"           TEXT         NOT NULL,
        "rate"            NUMERIC(5,2) NOT NULL,
        "type"            TEXT         NOT NULL,
        "kind"            TEXT         NOT NULL,
        "is_active"       BOOLEAN      NOT NULL DEFAULT TRUE,
        "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_tva_codes" PRIMARY KEY ("id"),
        CONSTRAINT "fk_tva_codes_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_tva_codes_org_code"
          UNIQUE ("organization_id", "code"),
        CONSTRAINT "chk_tva_codes_code_format"
          CHECK ("code" ~ '^[A-Z0-9-]{1,16}$'),
        CONSTRAINT "chk_tva_codes_rate_range"
          CHECK ("rate" >= 0 AND "rate" < 100),
        CONSTRAINT "chk_tva_codes_type"
          CHECK ("type" IN ('sales', 'purchase', 'both')),
        CONSTRAINT "chk_tva_codes_kind"
          CHECK ("kind" IN ('normal', 'reduced', 'exempt', 'exonerated', 'export'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_tva_codes_org_active"
        ON "tva_codes" ("organization_id", "is_active")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tva_codes"`);
  }
}
