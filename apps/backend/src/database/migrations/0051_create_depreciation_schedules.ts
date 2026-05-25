import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-IMMO-02 — `depreciation_schedules` : échéancier d'amortissement.
 *
 * Une ligne par exercice fiscal et par asset. Construit une fois à la
 * création de l'asset (calcul déterministe) ; régénéré uniquement si
 * la définition de l'asset change (durée, méthode, taux dégressif, ou
 * mise au rebut anticipée).
 *
 * Cycle :
 *   - `pending` : ligne calculée, pas encore passée en compta. Peut
 *     être supprimée lors d'une régénération.
 *   - `posted`  : `EntriesService.createDraft({sourceType:'depreciation'})`
 *     + `validate()` ont créé une `journal_entries`. La ligne devient
 *     immuable. `journal_entry_id` permet de remonter à l'écriture
 *     (et inversement via `journal_entries.source_type='depreciation'`).
 *
 * Annulation : on contre-passe l'écriture via Module 8 (cancel) ; la
 * ligne schedule reste `posted` (preuve d'audit que la dotation a bien
 * été tentée). On NE supprime PAS le schedule pour conserver la trace.
 *
 * Pas de FK depuis `journal_entry_id` : l'écriture peut être contre-
 * passée mais pas supprimée. On garde l'ID en référence faible — un
 * trigger de DELETE sur journal_entries la mettrait à NULL si jamais
 * un jour on autorisait la suppression, ce qui n'est pas le cas.
 * (Pour rester strict, on ajoute quand même la FK SET NULL.)
 */
export class CreateDepreciationSchedules1700000000051 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // IF NOT EXISTS — mêmes raisons que 0050_create_assets : la table
    // peut déjà exister si l'ancienne classe CreateDepreciationSchedules1700000000047
    // (renommée en 0051) a été appliquée avant le rename.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "depreciation_schedules" (
        "id"                       UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"          UUID         NOT NULL,
        "asset_id"                 UUID         NOT NULL,
        "fiscal_year"              INTEGER      NOT NULL,
        "period_start"             DATE         NOT NULL,
        "period_end"               DATE         NOT NULL,
        "depreciation_amount"      NUMERIC(15,2) NOT NULL,
        "cumulative_depreciation"  NUMERIC(15,2) NOT NULL,
        "net_book_value"           NUMERIC(15,2) NOT NULL,
        "status"                   TEXT         NOT NULL DEFAULT 'pending',
        "journal_entry_id"         UUID,
        "posted_at"                TIMESTAMPTZ,
        "posted_by_id"             UUID,
        "created_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_depreciation_schedules" PRIMARY KEY ("id"),
        CONSTRAINT "fk_depreciation_schedules_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_depreciation_schedules_asset"
          FOREIGN KEY ("asset_id")
          REFERENCES "assets" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_depreciation_schedules_journal_entry"
          FOREIGN KEY ("journal_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "uq_depreciation_schedules_asset_year"
          UNIQUE ("asset_id", "fiscal_year"),
        CONSTRAINT "chk_depreciation_schedules_status"
          CHECK ("status" IN ('pending', 'posted')),
        CONSTRAINT "chk_depreciation_schedules_amounts_non_negative"
          CHECK (
            "depreciation_amount" >= 0
            AND "cumulative_depreciation" >= 0
            AND "net_book_value" >= 0
          ),
        CONSTRAINT "chk_depreciation_schedules_period_consistent"
          CHECK ("period_end" >= "period_start"),
        CONSTRAINT "chk_depreciation_schedules_posted_has_entry"
          CHECK (
            ("status" = 'posted' AND "journal_entry_id" IS NOT NULL AND "posted_at" IS NOT NULL)
            OR
            ("status" = 'pending' AND "journal_entry_id" IS NULL AND "posted_at" IS NULL)
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_depreciation_schedules_org_year_status"
        ON "depreciation_schedules" ("organization_id", "fiscal_year", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "depreciation_schedules"`);
  }
}
