import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { StockFamily, StockItemStatus } from '../types/inventory.types';

/**
 * `inventory_items` row — voir migration 0066.
 *
 * Article de stock par organisation. Porte le SKU interne, la famille
 * (qui dicte le compte SYSCOHADA 31x..37x), et les 2-3 comptes
 * comptables agités au moment des mouvements :
 *
 *   - `stock_account_id`    → 31x..37x (compte de stock, classe 3)
 *   - `purchase_account_id` → 60x   (achat, charge)
 *   - `sale_account_id`     → 70x   (vente, produit) — NULL si non revendu
 *
 * Compteurs persistés : `currentQty` (NUMERIC(15,4) pour fractions kg)
 * et `currentCmp` (NUMERIC(15,4) — coût moyen pondéré, 4 décimales).
 * Ces champs sont calculés/maintenus par `InventoryMovementsService`
 * après chaque mouvement validé ; la source de vérité reste la table
 * `inventory_movements` (un recompute déterministe est possible via
 * `replayHistory`).
 */
@Entity({ name: 'inventory_items' })
@Index('uq_inventory_items_org_code', ['organizationId', 'code'], { unique: true })
@Index('ix_inventory_items_org_status', ['organizationId', 'status'])
@Index('ix_inventory_items_org_family', ['organizationId', 'family'])
export class InventoryItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ type: 'text' })
  code!: string;

  @Column({ type: 'text' })
  label!: string;

  @Column({ name: 'unit_of_measure', type: 'text', default: 'unit' })
  unitOfMeasure!: string;

  @Column({ type: 'text' })
  family!: StockFamily;

  @Column({ name: 'stock_account_id', type: 'uuid' })
  stockAccountId!: string;

  @Column({ name: 'purchase_account_id', type: 'uuid' })
  purchaseAccountId!: string;

  @Column({ name: 'sale_account_id', type: 'uuid', nullable: true })
  saleAccountId!: string | null;

  @Column({ name: 'current_qty', type: 'numeric', precision: 15, scale: 4, default: 0 })
  currentQty!: string;

  @Column({ name: 'current_cmp', type: 'numeric', precision: 15, scale: 4, default: 0 })
  currentCmp!: string;

  @Column({ type: 'text', default: 'active' })
  status!: StockItemStatus;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
