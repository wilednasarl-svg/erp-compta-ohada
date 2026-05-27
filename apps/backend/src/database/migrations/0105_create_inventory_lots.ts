import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * W4.2 — Méthode FIFO en alternative au CMUP + écritures auto sur
 * mouvements stock (Tome 2 chap 14, Tome 1 chap 6, App. 52 SYSCOHADA).
 *
 * Crée `inventory_lots` : une queue ordonnée de lots par article. À
 * chaque achat on insère un lot {qty, unitCost, entryDate}. À chaque
 * vente FIFO, on déduit les lots dans l'ordre chronologique (queue) et
 * on cumule le coût total = somme(qty_consommée × unitCost par lot).
 *
 * Indexes :
 *  - (item_id, entry_date ASC) — ordre FIFO de consommation
 *  - (org_id, item_id, remaining_qty) — listAvailable rapide
 *
 * `source_movement_id` lie le lot au mouvement `purchase` qui l'a créé
 * (ON DELETE SET NULL : un lot survit à la suppression accidentelle d'un
 * mouvement source — l'historique comptable reste intact).
 *
 * Étend `inventory_items` :
 *  - `valuation_method` TEXT NOT NULL DEFAULT 'cmp' CHECK IN ('cmp','fifo')
 *  - `account_code`     TEXT NULL — compte de stock (311/321/331...)
 *    utilisé par la génération automatique d'écriture comptable. Si
 *    NULL, le mouvement passe sans génération (log warning côté
 *    service).
 *
 * Numéro 0104 alloué : 0102 et 0103 déjà pris par
 * `create_subsequent_events` et `extend_journal_entry_source_type_tax`.
 */
export class CreateInventoryLots1700000000105 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Table inventory_lots ────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inventory_lots" (
        "id"                  UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"     UUID         NOT NULL,
        "inventory_item_id"   UUID         NOT NULL,
        "entry_date"          DATE         NOT NULL,
        "initial_qty"         NUMERIC(15,4) NOT NULL,
        "remaining_qty"       NUMERIC(15,4) NOT NULL,
        "unit_cost"           NUMERIC(15,4) NOT NULL,
        "source_movement_id"  UUID,
        "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_inventory_lots" PRIMARY KEY ("id"),
        CONSTRAINT "fk_inventory_lots_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_inventory_lots_item"
          FOREIGN KEY ("inventory_item_id")
          REFERENCES "inventory_items" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_inventory_lots_source_movement"
          FOREIGN KEY ("source_movement_id")
          REFERENCES "inventory_movements" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_inventory_lots_initial_qty_positive"
          CHECK ("initial_qty" > 0),
        CONSTRAINT "chk_inventory_lots_remaining_qty_nonneg"
          CHECK ("remaining_qty" >= 0),
        CONSTRAINT "chk_inventory_lots_remaining_le_initial"
          CHECK ("remaining_qty" <= "initial_qty"),
        CONSTRAINT "chk_inventory_lots_unit_cost_nonneg"
          CHECK ("unit_cost" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_inventory_lots_item_entry_date"
        ON "inventory_lots" ("inventory_item_id", "entry_date" ASC, "created_at" ASC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_inventory_lots_org_item_remaining"
        ON "inventory_lots" ("organization_id", "inventory_item_id", "remaining_qty")
    `);

    // ─── ALTER inventory_items ──────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "inventory_items"
        ADD COLUMN IF NOT EXISTS "valuation_method" TEXT NOT NULL DEFAULT 'cmp'
    `);
    await queryRunner.query(`
      ALTER TABLE "inventory_items"
        DROP CONSTRAINT IF EXISTS "chk_inventory_items_valuation_method"
    `);
    await queryRunner.query(`
      ALTER TABLE "inventory_items"
        ADD CONSTRAINT "chk_inventory_items_valuation_method"
        CHECK ("valuation_method" IN ('cmp', 'fifo'))
    `);
    await queryRunner.query(`
      ALTER TABLE "inventory_items"
        ADD COLUMN IF NOT EXISTS "account_code" TEXT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "inventory_items"
        DROP COLUMN IF EXISTS "account_code"
    `);
    await queryRunner.query(`
      ALTER TABLE "inventory_items"
        DROP CONSTRAINT IF EXISTS "chk_inventory_items_valuation_method"
    `);
    await queryRunner.query(`
      ALTER TABLE "inventory_items"
        DROP COLUMN IF EXISTS "valuation_method"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_inventory_lots_org_item_remaining"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_inventory_lots_item_entry_date"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_lots"`);
  }
}
