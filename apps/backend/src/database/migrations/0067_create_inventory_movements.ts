import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-STOCK-02 — `inventory_movements` : journal append-only des
 * mouvements de stock. Source de vérité de l'historique.
 *
 * Snapshot {qty_after, cmp_after} stocké après application du
 * mouvement → le drill-down "quel était le stock à telle date" est une
 * simple lecture ordonnée, sans recalcul. Cohérent avec le pattern
 * Module 8 (journal_entries.entry_date + ordering sur entry_number).
 *
 * `journal_entry_id` est NULLABLE en wave 1 (la génération auto
 * d'écritures comptables sur mouvement vient en wave 2 — il faudra à
 * ce moment-là étendre la CHECK `chk_journal_entries_source_type` de
 * Module 8 pour accepter `'inventory'`).
 *
 * Pas de CHECK sur le signe de `qty` : adjustment peut être négatif,
 * sale est positif (la direction est dans `type`). Le contrôle de
 * cohérence est applicatif (CmpCalculator + InventoryMovementsService).
 */
export class CreateInventoryMovements1700000000067 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "inventory_movements" (
        "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"   UUID         NOT NULL,
        "item_id"           UUID         NOT NULL,
        "type"              TEXT         NOT NULL,
        "movement_date"     DATE         NOT NULL,
        "qty"               NUMERIC(15,4) NOT NULL,
        "unit_price"        NUMERIC(15,4),
        "qty_after"         NUMERIC(15,4) NOT NULL,
        "cmp_after"         NUMERIC(15,4) NOT NULL,
        "movement_value"    NUMERIC(15,2) NOT NULL,
        "reference"         TEXT,
        "description"       TEXT,
        "journal_entry_id"  UUID,
        "created_by_id"     UUID,
        "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_inventory_movements" PRIMARY KEY ("id"),
        CONSTRAINT "fk_inventory_movements_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_inventory_movements_item"
          FOREIGN KEY ("item_id")
          REFERENCES "inventory_items" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_inventory_movements_journal_entry"
          FOREIGN KEY ("journal_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_inventory_movements_type"
          CHECK ("type" IN (
            'purchase', 'sale', 'adjustment', 'inventory_count', 'production'
          )),
        CONSTRAINT "chk_inventory_movements_qty_after_nonneg"
          CHECK ("qty_after" >= 0),
        CONSTRAINT "chk_inventory_movements_cmp_after_nonneg"
          CHECK ("cmp_after" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_inventory_movements_item_date"
        ON "inventory_movements" ("item_id", "movement_date" DESC, "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_inventory_movements_org_type_date"
        ON "inventory_movements" ("organization_id", "type", "movement_date" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_movements"`);
  }
}
