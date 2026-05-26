import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * W3.2 — `asset_impairments` + `inventory_impairments` : tests de valeur
 * SYSCOHADA (Tome 2 chap. 12 immo, chap. 14 stocks, App. 44 reprise plafonnée).
 *
 * Une ligne par test de valeur effectué :
 *   - Immo : VNC vs valeur actuelle (recoverable amount). Si VNC > VA,
 *     dotation D 6917 / C 29x. Si reprise (valeur remonte alors qu'une
 *     dépréciation antérieure existait), D 29x / C 7917, plafonnée au
 *     cumul des dépréciations passées (article 44 doctrine).
 *   - Stocks : Coût CMUP × Qté vs NRV. D 6593 / C 39x ou D 39x / C 7593.
 *
 * `journal_entry_id` NULLABLE : l'écriture est créée via EntriesService
 * mais on garde la trace même si elle est ensuite annulée (SET NULL).
 *
 * Permissions `impairments.read` / `impairments.write` posées dans la
 * même migration pour éviter une migration RBAC orpheline.
 */
export class CreateImpairments1700000000097 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Table asset_impairments ──────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "asset_impairments" (
        "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"    UUID         NOT NULL,
        "asset_id"           UUID         NOT NULL,
        "test_date"          DATE         NOT NULL,
        "carrying_amount"    NUMERIC(15,2) NOT NULL,
        "recoverable_amount" NUMERIC(15,2) NOT NULL,
        "impairment_amount"  NUMERIC(15,2) NOT NULL,
        "type"               TEXT         NOT NULL,
        "journal_entry_id"   UUID,
        "note"               TEXT,
        "created_by_id"      UUID,
        "created_at"         TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_asset_impairments" PRIMARY KEY ("id"),
        CONSTRAINT "fk_asset_impairments_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_asset_impairments_asset"
          FOREIGN KEY ("asset_id")
          REFERENCES "assets" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_asset_impairments_journal_entry"
          FOREIGN KEY ("journal_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_asset_impairments_type"
          CHECK ("type" IN ('depreciation', 'reprise')),
        CONSTRAINT "chk_asset_impairments_amount_nonneg"
          CHECK ("impairment_amount" >= 0),
        CONSTRAINT "chk_asset_impairments_carrying_nonneg"
          CHECK ("carrying_amount" >= 0),
        CONSTRAINT "chk_asset_impairments_recoverable_nonneg"
          CHECK ("recoverable_amount" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_asset_impairments_org_asset"
        ON "asset_impairments" ("organization_id", "asset_id", "test_date" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_asset_impairments_org_date"
        ON "asset_impairments" ("organization_id", "test_date" DESC)
    `);

    // ─── Table inventory_impairments ──────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inventory_impairments" (
        "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"    UUID         NOT NULL,
        "inventory_item_id"  UUID         NOT NULL,
        "test_date"          DATE         NOT NULL,
        "carrying_amount"    NUMERIC(15,2) NOT NULL,
        "nrv"                NUMERIC(15,2) NOT NULL,
        "impairment_amount"  NUMERIC(15,2) NOT NULL,
        "type"               TEXT         NOT NULL,
        "journal_entry_id"   UUID,
        "note"               TEXT,
        "created_by_id"      UUID,
        "created_at"         TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_inventory_impairments" PRIMARY KEY ("id"),
        CONSTRAINT "fk_inventory_impairments_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_inventory_impairments_item"
          FOREIGN KEY ("inventory_item_id")
          REFERENCES "inventory_items" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_inventory_impairments_journal_entry"
          FOREIGN KEY ("journal_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_inventory_impairments_type"
          CHECK ("type" IN ('depreciation', 'reprise')),
        CONSTRAINT "chk_inventory_impairments_amount_nonneg"
          CHECK ("impairment_amount" >= 0),
        CONSTRAINT "chk_inventory_impairments_carrying_nonneg"
          CHECK ("carrying_amount" >= 0),
        CONSTRAINT "chk_inventory_impairments_nrv_nonneg"
          CHECK ("nrv" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_inventory_impairments_org_item"
        ON "inventory_impairments" ("organization_id", "inventory_item_id", "test_date" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_inventory_impairments_org_date"
        ON "inventory_impairments" ("organization_id", "test_date" DESC)
    `);

    // ─── RBAC permissions ─────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('impairments.read',  'Read asset / inventory impairment tests register'),
        ('impairments.write', 'Run impairment tests and post the related entries')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'impairments.read'),
        ('admin',            'impairments.write'),
        ('expert_comptable', 'impairments.read'),
        ('expert_comptable', 'impairments.write'),
        ('chef_mission',     'impairments.read'),
        ('chef_mission',     'impairments.write'),
        ('comptable',        'impairments.read'),
        ('comptable',        'impairments.write'),
        ('auditeur',         'impairments.read'),
        ('client_readonly',  'impairments.read')
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
        WHERE "code" IN ('impairments.read', 'impairments.write')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('impairments.read', 'impairments.write')
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_impairments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "asset_impairments"`);
  }
}
