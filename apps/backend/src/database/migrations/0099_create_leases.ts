import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * W4.5 — `leases` / `lease_installments` / `lease_payments` :
 *   registre SYSCOHADA des contrats de crédit-bail et de
 *   location-acquisition (tome 2 chap. 8, annexes 37-38).
 *
 *   Schéma comptable du dispositif :
 *
 *     - Prise du contrat :
 *         D 2411  Matériel financé (juste valeur)
 *         C 173   Dettes de location-acquisition
 *
 *     - Échéance loyer :
 *         D 6724  Intérêts sur location-acquisition
 *         D 173   Capital remboursé sur la dette
 *         C 521   Banque                (total décaissé)
 *
 *   Le taux d'intérêt implicite n'est pas stocké dans le contrat —
 *   il est déduit par bisection à partir de la juste valeur, du
 *   loyer périodique, de la durée et de l'option d'achat. Le service
 *   le calcule à la création (`ImplicitRateCalculator`) et stocke le
 *   taux annuel en NUMERIC(7,5) (cinq décimales = 0.001 %).
 *
 *   `journal_entry_id_initial` est NULLABLE : si l'écriture initiale
 *   échoue, on conserve le contrat (statut active) et un follow-up
 *   permettra de rejouer l'écriture sans perdre l'historique.
 *
 *   `asset_id` est NULLABLE : un crédit-bail peut être posé avant
 *   l'enregistrement de l'asset au registre des immobilisations. La
 *   FK est SET NULL pour ne pas casser le contrat si l'asset est
 *   supprimé.
 *
 *   Pas de migration RBAC ici — les permissions seront ajoutées
 *   avec la PR controller (wave 2).
 */
export class CreateLeases1700000000099 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Table leases ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leases" (
        "id"                          UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"             UUID         NOT NULL,
        "asset_id"                    UUID,
        "contract_ref"                TEXT         NOT NULL,
        "lessor_name"                 TEXT         NOT NULL,
        "start_date"                  DATE         NOT NULL,
        "end_date"                    DATE         NOT NULL,
        "fair_value"                  NUMERIC(15,2) NOT NULL,
        "nominal_total_amount"        NUMERIC(15,2) NOT NULL,
        "implicit_rate"               NUMERIC(7,5)  NOT NULL,
        "purchase_option_amount"      NUMERIC(15,2) NOT NULL DEFAULT 0,
        "frequency"                   TEXT         NOT NULL,
        "number_of_installments"      INTEGER      NOT NULL,
        "status"                      TEXT         NOT NULL DEFAULT 'active',
        "journal_entry_id_initial"    UUID,
        "note"                        TEXT,
        "created_by_id"               UUID,
        "created_at"                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_leases" PRIMARY KEY ("id"),
        CONSTRAINT "fk_leases_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_leases_asset"
          FOREIGN KEY ("asset_id")
          REFERENCES "assets" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_leases_journal_entry_initial"
          FOREIGN KEY ("journal_entry_id_initial")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_leases_frequency"
          CHECK ("frequency" IN ('monthly', 'quarterly', 'annual')),
        CONSTRAINT "chk_leases_status"
          CHECK ("status" IN ('active', 'closed', 'cancelled')),
        CONSTRAINT "chk_leases_fair_value_positive"
          CHECK ("fair_value" > 0),
        CONSTRAINT "chk_leases_installments_positive"
          CHECK ("number_of_installments" > 0),
        CONSTRAINT "chk_leases_dates_consistent"
          CHECK ("end_date" >= "start_date")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_leases_org_status"
        ON "leases" ("organization_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_leases_org_asset"
        ON "leases" ("organization_id", "asset_id")
    `);

    // ─── Table lease_installments ─────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lease_installments" (
        "id"                  UUID         NOT NULL DEFAULT gen_random_uuid(),
        "lease_id"            UUID         NOT NULL,
        "organization_id"     UUID         NOT NULL,
        "due_date"            DATE         NOT NULL,
        "installment_number"  INTEGER      NOT NULL,
        "total_amount"        NUMERIC(15,2) NOT NULL,
        "interest_part"       NUMERIC(15,2) NOT NULL,
        "capital_part"        NUMERIC(15,2) NOT NULL,
        "outstanding_balance" NUMERIC(15,2) NOT NULL,
        "paid"                BOOLEAN      NOT NULL DEFAULT false,
        "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_lease_installments" PRIMARY KEY ("id"),
        CONSTRAINT "fk_lease_installments_lease"
          FOREIGN KEY ("lease_id")
          REFERENCES "leases" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_lease_installments_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_lease_installments_amount_positive"
          CHECK ("total_amount" >= 0),
        CONSTRAINT "chk_lease_installments_number_positive"
          CHECK ("installment_number" > 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_lease_installments_lease_due"
        ON "lease_installments" ("lease_id", "due_date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_lease_installments_org_due"
        ON "lease_installments" ("organization_id", "due_date")
    `);

    // ─── Table lease_payments ─────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lease_payments" (
        "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
        "lease_id"          UUID         NOT NULL,
        "installment_id"    UUID         NOT NULL,
        "organization_id"   UUID         NOT NULL,
        "payment_date"      DATE         NOT NULL,
        "amount"            NUMERIC(15,2) NOT NULL,
        "interest_part"     NUMERIC(15,2) NOT NULL,
        "capital_part"      NUMERIC(15,2) NOT NULL,
        "journal_entry_id"  UUID,
        "note"              TEXT,
        "created_by_id"     UUID,
        "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_lease_payments" PRIMARY KEY ("id"),
        CONSTRAINT "fk_lease_payments_lease"
          FOREIGN KEY ("lease_id")
          REFERENCES "leases" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_lease_payments_installment"
          FOREIGN KEY ("installment_id")
          REFERENCES "lease_installments" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_lease_payments_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_lease_payments_journal_entry"
          FOREIGN KEY ("journal_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_lease_payments_amount_positive"
          CHECK ("amount" > 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_lease_payments_lease_date"
        ON "lease_payments" ("lease_id", "payment_date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_lease_payments_org_date"
        ON "lease_payments" ("organization_id", "payment_date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lease_payments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lease_installments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "leases"`);
  }
}
