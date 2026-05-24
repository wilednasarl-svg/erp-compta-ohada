import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-LET-01 — `partner_letterings` : réconciliation tiers (lettrage).
 *
 * Une opération de lettrage regroupe plusieurs lignes d'écritures
 * comptables (toutes sur le MÊME compte tiers, ex. `411000` Client X)
 * dont la somme des débits égale la somme des crédits. Concrètement :
 *
 *   - une facture client (débit 411 / crédit 707) crée une ligne
 *     `debit=1200` sur 411 ;
 *   - l'encaissement (débit 512 / crédit 411) crée une ligne
 *     `credit=1200` sur 411 ;
 *   - le lettrage marque ces deux lignes comme "soldées ensemble".
 *
 * Modèle relationnel :
 *   - `partner_letterings` porte la métadonnée du lettrage (code lisible,
 *     compte tiers, montant total, statut, qui/quand) ;
 *   - chaque `journal_entry_lines` lettrée pointe sur le lettering via
 *     `lettering_id` (FK ajoutée ci-dessous). C'est une relation 1-N :
 *     N lignes pour 1 lettrage. Pas de table de jointure.
 *
 * Cycle de vie :
 *   - `open`     : créé, lignes attachées, somme débit = crédit.
 *   - `complete` : alias informationnel pour `open` quand toutes les
 *                  lignes attachées le mettent à zéro (cas le plus
 *                  fréquent — facture + encaissement = lettrage complet).
 *   - `broken`   : "délettré" par un utilisateur. Le record reste pour
 *                  audit, mais `lettering_id` des lignes est passé à
 *                  NULL via `ON DELETE SET NULL` puis on garde le
 *                  record pour traçabilité. Le délettrage applicatif
 *                  passe le record en `broken` ET retire l'id des
 *                  lignes en une seule transaction.
 *
 * Index :
 *   - `(organization_id, lettering_code)` UNIQUE — humainement,
 *     l'utilisateur référence un lettrage par son code (A0001…).
 *   - `(organization_id, partner_account_id, status)` — la balance
 *     âgée filtre "lignes non lettrées" par compte tiers.
 *
 * Permissions : `journals.lettering` (seed en 0044).
 */
export class CreatePartnerLetterings1700000000043 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "partner_letterings" (
        "id"                    UUID           NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"       UUID           NOT NULL,
        "lettering_code"        VARCHAR(8)     NOT NULL,
        "partner_account_id"    UUID           NOT NULL,
        "partner_label"         TEXT           NOT NULL,
        "total_amount"          DECIMAL(15, 2) NOT NULL,
        "status"                VARCHAR(16)    NOT NULL DEFAULT 'open',
        "created_by_id"         UUID           NOT NULL,
        "created_at"            TIMESTAMPTZ    NOT NULL DEFAULT now(),
        "completed_at"          TIMESTAMPTZ,
        "broken_at"             TIMESTAMPTZ,
        "broken_reason"         TEXT,
        "broken_by_id"          UUID,
        CONSTRAINT "pk_partner_letterings" PRIMARY KEY ("id"),
        CONSTRAINT "fk_partner_letterings_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_partner_letterings_account"
          FOREIGN KEY ("partner_account_id")
          REFERENCES "organization_chart_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_partner_letterings_created_by"
          FOREIGN KEY ("created_by_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_partner_letterings_broken_by"
          FOREIGN KEY ("broken_by_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_partner_letterings_org_code"
          UNIQUE ("organization_id", "lettering_code"),
        CONSTRAINT "chk_partner_letterings_status"
          CHECK ("status" IN ('open', 'complete', 'broken')),
        CONSTRAINT "chk_partner_letterings_total_positive"
          CHECK ("total_amount" > 0),
        CONSTRAINT "chk_partner_letterings_broken_fields"
          CHECK (
            ("status" = 'broken' AND "broken_at" IS NOT NULL AND "broken_by_id" IS NOT NULL)
            OR
            ("status" <> 'broken' AND "broken_at" IS NULL AND "broken_by_id" IS NULL)
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_partner_letterings_org_account_status"
        ON "partner_letterings" ("organization_id", "partner_account_id", "status")
    `);

    // FK column on journal_entry_lines so a lettered line points back
    // to its lettering. NULL = unlettered. ON DELETE SET NULL so that
    // breaking a lettering at the DB level (admin path) leaves lines
    // intact and just unlets them.
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines"
        ADD COLUMN "lettering_id" UUID NULL,
        ADD CONSTRAINT "fk_journal_entry_lines_lettering"
          FOREIGN KEY ("lettering_id")
          REFERENCES "partner_letterings" ("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_journal_entry_lines_lettering"
        ON "journal_entry_lines" ("lettering_id")
        WHERE "lettering_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "ix_journal_entry_lines_lettering"
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines"
        DROP CONSTRAINT IF EXISTS "fk_journal_entry_lines_lettering",
        DROP COLUMN IF EXISTS "lettering_id"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "partner_letterings"`);
  }
}
