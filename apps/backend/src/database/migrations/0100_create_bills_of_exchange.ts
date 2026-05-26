import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * W4.6 — `bills_of_exchange` + `bill_events` : registre SYSCOHADA des
 * effets de commerce (traite, billet a ordre). Voir Tome 1 G07,
 * articles R22 a R25 et App. 12 du plan comptable SYSCOHADA.
 *
 * Comptes SYSCOHADA actionnes (mapping figé côté `bill.types.ts`,
 * pas en DB — un ajustement de plan comptable ne casse pas la table) :
 *
 *   role                            | compte
 *   --------------------------------+--------
 *   effets a recevoir               | 412
 *   effets escomptes non echus      | 415
 *   effets a payer                  | 402
 *   banque                          | 5121
 *   escompte bancaire (agio)        | 6745
 *   frais bancaires                 | 6312
 *   clients douteux (impaye)        | 4131
 *
 * Cycles :
 *   - Receivable : issued → discounted? → paid / unpaid
 *   - Payable    : issued → paid
 *
 * `journal_entry_id` (events) et `original_journal_entry_id` (bill)
 * sont SET NULL : si une ecriture est purgee, l'effet reste tracable
 * mais perd son ancrage comptable. Permissions
 * `bills_of_exchange.read` / `bills_of_exchange.write` ajoutees ici
 * pour eviter une migration RBAC orpheline.
 */
export class CreateBillsOfExchange1700000000100 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Table bills_of_exchange ──────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bills_of_exchange" (
        "id"                          UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"             UUID         NOT NULL,
        "kind"                        TEXT         NOT NULL,
        "partner_account_code"        TEXT         NOT NULL,
        "partner_name"                TEXT         NOT NULL,
        "bill_number"                 TEXT         NOT NULL,
        "issue_date"                  DATE         NOT NULL,
        "due_date"                    DATE         NOT NULL,
        "nominal_amount"              NUMERIC(15,2) NOT NULL,
        "status"                      TEXT         NOT NULL DEFAULT 'issued',
        "current_location_account"    TEXT         NOT NULL,
        "original_journal_entry_id"   UUID,
        "note"                        TEXT,
        "created_by_id"               UUID,
        "created_at"                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_bills_of_exchange" PRIMARY KEY ("id"),
        CONSTRAINT "fk_bills_of_exchange_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_bills_of_exchange_original_entry"
          FOREIGN KEY ("original_journal_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_bills_of_exchange_kind"
          CHECK ("kind" IN ('receivable', 'payable')),
        CONSTRAINT "chk_bills_of_exchange_status"
          CHECK ("status" IN ('issued', 'discounted', 'paid', 'unpaid', 'cancelled')),
        CONSTRAINT "chk_bills_of_exchange_nominal_positive"
          CHECK ("nominal_amount" > 0),
        CONSTRAINT "chk_bills_of_exchange_dates"
          CHECK ("due_date" >= "issue_date")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_bills_of_exchange_org_status"
        ON "bills_of_exchange" ("organization_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_bills_of_exchange_org_due_date"
        ON "bills_of_exchange" ("organization_id", "due_date")
    `);

    // ─── Table bill_events ────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bill_events" (
        "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
        "bill_id"           UUID         NOT NULL,
        "organization_id"   UUID         NOT NULL,
        "event_type"        TEXT         NOT NULL,
        "event_date"        DATE         NOT NULL,
        "amount"            NUMERIC(15,2) NOT NULL,
        "discount_fee"      NUMERIC(15,2),
        "bank_fee"          NUMERIC(15,2),
        "net_amount"        NUMERIC(15,2),
        "journal_entry_id"  UUID,
        "note"              TEXT,
        "created_by_id"     UUID,
        "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_bill_events" PRIMARY KEY ("id"),
        CONSTRAINT "fk_bill_events_bill"
          FOREIGN KEY ("bill_id")
          REFERENCES "bills_of_exchange" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_bill_events_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_bill_events_journal_entry"
          FOREIGN KEY ("journal_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_bill_events_event_type"
          CHECK ("event_type" IN ('issuance', 'discount', 'payment', 'unpaid_return')),
        CONSTRAINT "chk_bill_events_amount_positive"
          CHECK ("amount" > 0),
        CONSTRAINT "chk_bill_events_discount_fee_nonneg"
          CHECK ("discount_fee" IS NULL OR "discount_fee" >= 0),
        CONSTRAINT "chk_bill_events_bank_fee_nonneg"
          CHECK ("bank_fee" IS NULL OR "bank_fee" >= 0),
        CONSTRAINT "chk_bill_events_net_amount_nonneg"
          CHECK ("net_amount" IS NULL OR "net_amount" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_bill_events_bill"
        ON "bill_events" ("bill_id", "event_date" DESC, "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_bill_events_org_type"
        ON "bill_events" ("organization_id", "event_type", "event_date" DESC)
    `);

    // ─── RBAC permissions ─────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('bills_of_exchange.read',  'Read bills of exchange register'),
        ('bills_of_exchange.write', 'Issue / discount / settle / unpaid bills of exchange')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'bills_of_exchange.read'),
        ('admin',            'bills_of_exchange.write'),
        ('expert_comptable', 'bills_of_exchange.read'),
        ('expert_comptable', 'bills_of_exchange.write'),
        ('chef_mission',     'bills_of_exchange.read'),
        ('chef_mission',     'bills_of_exchange.write'),
        ('comptable',        'bills_of_exchange.read'),
        ('comptable',        'bills_of_exchange.write'),
        ('auditeur',         'bills_of_exchange.read'),
        ('client_readonly',  'bills_of_exchange.read')
      ) AS mapping(role_code, perm_code)
        ON r."code" = mapping.role_code AND p."code" = mapping.perm_code
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions"
        WHERE "code" IN ('bills_of_exchange.read', 'bills_of_exchange.write')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('bills_of_exchange.read', 'bills_of_exchange.write')
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "bill_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bills_of_exchange"`);
  }
}
