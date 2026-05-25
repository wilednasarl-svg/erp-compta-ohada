import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-STOCK-01 — `inventory_items` : registre des articles de stock.
 *
 * Une ligne par article par organisation. Le `code` (SKU interne) est
 * unique scopé tenant. La famille SYSCOHADA détermine indirectement la
 * racine du `stock_account_id` (31x..37x), mais le contrôle reste
 * applicatif — un comptable peut vouloir un compte custom dans la même
 * classe.
 *
 * Compteurs `current_qty` / `current_cmp` : maintenus par
 * `InventoryMovementsService` après chaque mouvement. NUMERIC(15,4)
 * pour absorber les unités fractionnaires (kg, mètres, litres).
 *
 * FK vers `organization_chart_accounts` avec ON DELETE RESTRICT : on
 * ne supprime pas un compte qui sert de référence stock. Le contrôle
 * d'appartenance au même tenant est applicatif (cf.
 * `OrganizationAccountRepository.findById` qui filtre sur organizationId).
 */
export class CreateInventoryItems1700000000066 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "inventory_items" (
        "id"                    UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"       UUID         NOT NULL,
        "code"                  TEXT         NOT NULL,
        "label"                 TEXT         NOT NULL,
        "unit_of_measure"       TEXT         NOT NULL DEFAULT 'unit',
        "family"                TEXT         NOT NULL,
        "stock_account_id"      UUID         NOT NULL,
        "purchase_account_id"   UUID         NOT NULL,
        "sale_account_id"       UUID,
        "current_qty"           NUMERIC(15,4) NOT NULL DEFAULT 0,
        "current_cmp"           NUMERIC(15,4) NOT NULL DEFAULT 0,
        "status"                TEXT         NOT NULL DEFAULT 'active',
        "created_by_id"         UUID,
        "created_at"            TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_inventory_items" PRIMARY KEY ("id"),
        CONSTRAINT "fk_inventory_items_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_inventory_items_stock_account"
          FOREIGN KEY ("stock_account_id")
          REFERENCES "organization_chart_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_inventory_items_purchase_account"
          FOREIGN KEY ("purchase_account_id")
          REFERENCES "organization_chart_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_inventory_items_sale_account"
          FOREIGN KEY ("sale_account_id")
          REFERENCES "organization_chart_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_inventory_items_org_code"
          UNIQUE ("organization_id", "code"),
        CONSTRAINT "chk_inventory_items_code_format"
          CHECK ("code" ~ '^[A-Z0-9-]{1,32}$'),
        CONSTRAINT "chk_inventory_items_family"
          CHECK ("family" IN (
            'marchandises', 'matieres', 'fournitures',
            'en_cours', 'produits_finis', 'en_route'
          )),
        CONSTRAINT "chk_inventory_items_status"
          CHECK ("status" IN ('active', 'archived')),
        CONSTRAINT "chk_inventory_items_qty_nonneg"
          CHECK ("current_qty" >= 0),
        CONSTRAINT "chk_inventory_items_cmp_nonneg"
          CHECK ("current_cmp" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_inventory_items_org_status"
        ON "inventory_items" ("organization_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_inventory_items_org_family"
        ON "inventory_items" ("organization_id", "family")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_items"`);
  }
}
