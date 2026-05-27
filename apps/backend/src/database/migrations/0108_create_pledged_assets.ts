import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * E1 — `pledged_assets` : registre SYSCOHADA des sûretés réelles
 * données par l'entité sur ses actifs en garantie d'une dette
 * financière (Tome 3 p. 35).
 *
 * Cette table alimente :
 *   - la Note 1 (dettes garanties par sûretés réelles — vue passif),
 *   - la Note 16B bis (actifs nantis / sûretés données — vue actif),
 *   - le tableau « hors bilan » de la fiche de synthèse.
 *
 * Choix structurels :
 *  - `liability_account_code` VARCHAR(16) — code SYSCOHADA du compte
 *    de dette garantie (16x, 17x, 18x ou 4x partiel). Pas de FK vers
 *    `organization_accounts` pour rester découplé du plan comptable
 *    de chaque tenant ; le code est repris brut dans la note annexe.
 *  - `pledge_type` TEXT contraint CHECK — nature juridique
 *    ('hypotheque' | 'nantissement' | 'gage' | 'caution' | 'autre').
 *  - `status` TEXT contraint CHECK — cycle de vie
 *    ('active' | 'released' | 'cancelled'). Une sûreté active
 *    figure dans les notes ; les autres sont conservées pour
 *    traçabilité mais exclues.
 *  - `brut_amount` NUMERIC(15,2) — montant brut de la dette garantie.
 *    Cohérent avec le reste du module reports (précision décimale).
 *
 * Indexes :
 *   - (organization_id, status) — listing des sûretés actives par tenant.
 *   - (organization_id, pledge_type) — agrégation par nature pour la note.
 *   - (start_date) — pivot temporel pour `listActiveAsOf`.
 *
 * Numéro 0108 alloué — 0107 pris par `remap_note_annexe_comments`.
 */
export class CreatePledgedAssets1700000000108 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pledged_assets" (
        "id"                       UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"          UUID         NOT NULL,
        "liability_account_code"   VARCHAR(16)  NOT NULL,
        "liability_label"          TEXT         NOT NULL,
        "brut_amount"              NUMERIC(15,2) NOT NULL,
        "pledge_type"              TEXT         NOT NULL,
        "asset_reference"          TEXT         NOT NULL,
        "asset_location"           TEXT         NULL,
        "creditor_name"            TEXT         NOT NULL,
        "start_date"               DATE         NOT NULL,
        "end_date"                 DATE         NULL,
        "status"                   TEXT         NOT NULL DEFAULT 'active',
        "comment"                  TEXT         NULL,
        "created_by_id"            UUID         NULL,
        "released_at"              TIMESTAMPTZ  NULL,
        "created_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_pledged_assets" PRIMARY KEY ("id"),
        CONSTRAINT "fk_pledged_assets_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_pledged_assets_pledge_type"
          CHECK ("pledge_type" IN ('hypotheque', 'nantissement', 'gage', 'caution', 'autre')),
        CONSTRAINT "chk_pledged_assets_status"
          CHECK ("status" IN ('active', 'released', 'cancelled')),
        CONSTRAINT "chk_pledged_assets_brut_positive"
          CHECK ("brut_amount" > 0),
        CONSTRAINT "chk_pledged_assets_date_range"
          CHECK ("end_date" IS NULL OR "end_date" >= "start_date")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_pledged_assets_org_status"
        ON "pledged_assets" ("organization_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_pledged_assets_org_type"
        ON "pledged_assets" ("organization_id", "pledge_type")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_pledged_assets_start_date"
        ON "pledged_assets" ("start_date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pledged_assets"`);
  }
}
