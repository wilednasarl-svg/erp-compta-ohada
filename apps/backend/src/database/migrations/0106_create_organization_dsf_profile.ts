import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * W5.1 — Identification d'entité SYSCOHADA + page de garde DSF
 * (Tome 3 p. 18-31).
 *
 * Une seule ligne `organization_dsf_profile` par organisation (contrainte
 * UNIQUE sur `organization_id`) — c'est l'agrégat racine des Fiches R1
 * (page de garde), R2 (identification), R3 (dirigeants) et R4
 * (applicabilité des 36 notes annexes). Le service
 * `DsfIdentificationService` lit cette ligne pour assembler la liasse.
 *
 * Choix structurels :
 *  - `notes_applicable` JSONB — Record<noteId, boolean> ex.
 *    `{"N1": true, "N5": false}`. JSONB plutôt qu'une table dédiée car
 *    la liste des 36 notes est figée par l'AUDCIF et la sémantique est
 *    purement booléenne par note (case A/N/A). Aucune jointure utile.
 *  - `workforce_by_qualification` JSONB — Record<qualification, number>
 *    ex. `{"YA cadres": 5, "YB maîtrise": 12}`. Codes lettrés YA-YO de
 *    la masse salariale (Tome 3 p. 30).
 *  - `capital` NUMERIC(15,2) — capital social libéré. Précision
 *    suffisante pour les sociétés de la zone OHADA (limite à 999 999
 *    999 999 999.99 XOF).
 *  - `country` TEXT(3) — code ISO 3166-1 alpha-3 (CIV, SEN, BEN, etc.)
 *    pour piloter les particularités fiscales locales (NINEA Sénégal,
 *    IFU CI, etc.).
 *
 * Pas de soft-delete : si une organisation est supprimée, son profile
 * DSF disparaît avec elle (ON DELETE CASCADE) — aucune valeur d'audit
 * isolée.
 *
 * Numéro 0106 alloué — 0105 pris par `create_inventory_lots`.
 */
export class CreateOrganizationDsfProfile1700000000106 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "organization_dsf_profile" (
        "id"                          UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"             UUID         NOT NULL,
        "legal_form"                  TEXT         NULL,
        "tax_regime"                  TEXT         NULL,
        "country"                     TEXT         NULL,
        "ninea"                       TEXT         NULL,
        "rccm"                        TEXT         NULL,
        "siege_address"               TEXT         NULL,
        "siege_city"                  TEXT         NULL,
        "phone"                       TEXT         NULL,
        "email"                       TEXT         NULL,
        "capital"                     NUMERIC(15,2) NULL,
        "currency"                    TEXT         NOT NULL DEFAULT 'XOF',
        "activity_sector"             TEXT         NULL,
        "director_name"               TEXT         NULL,
        "director_title"              TEXT         NULL,
        "president_name"              TEXT         NULL,
        "auditor_name"                TEXT         NULL,
        "notes_applicable"            JSONB        NOT NULL DEFAULT '{}'::jsonb,
        "workforce_by_qualification"  JSONB        NOT NULL DEFAULT '{}'::jsonb,
        "created_at"                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_organization_dsf_profile" PRIMARY KEY ("id"),
        CONSTRAINT "uq_organization_dsf_profile_org"
          UNIQUE ("organization_id"),
        CONSTRAINT "fk_organization_dsf_profile_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_organization_dsf_profile_country_len"
          CHECK ("country" IS NULL OR char_length("country") = 3),
        CONSTRAINT "chk_organization_dsf_profile_currency_len"
          CHECK (char_length("currency") = 3),
        CONSTRAINT "chk_organization_dsf_profile_capital_nonneg"
          CHECK ("capital" IS NULL OR "capital" >= 0)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "organization_dsf_profile"`);
  }
}
