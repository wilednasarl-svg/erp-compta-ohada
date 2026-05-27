import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { InventoryItemEntity } from './inventory-item.entity';
import { InventoryMovementEntity } from './inventory-movement.entity';

/**
 * `inventory_lots` row — voir migration 0104.
 *
 * Queue ordonnée de lots par article pour la méthode FIFO (W4.2).
 * Chaque achat crée un lot avec `initialQty` et `unitCost`. À chaque
 * vente FIFO, on consomme `remainingQty` en suivant l'ordre
 * `entryDate ASC, createdAt ASC` jusqu'à couvrir la quantité demandée.
 *
 * `sourceMovementId` lie le lot au mouvement d'achat — SET NULL si le
 * mouvement disparaît (sécurité historique).
 */
@Entity({ name: 'inventory_lots' })
@Index('ix_inventory_lots_item_entry_date', ['inventoryItemId', 'entryDate', 'createdAt'])
@Index('ix_inventory_lots_org_item_remaining', ['organizationId', 'inventoryItemId', 'remainingQty'])
export class InventoryLotEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'inventory_item_id', type: 'uuid' })
  inventoryItemId!: string;

  @ManyToOne(() => InventoryItemEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inventory_item_id' })
  item!: InventoryItemEntity;

  @Column({ name: 'entry_date', type: 'date' })
  entryDate!: string;

  @Column({ name: 'initial_qty', type: 'numeric', precision: 15, scale: 4 })
  initialQty!: string;

  @Column({ name: 'remaining_qty', type: 'numeric', precision: 15, scale: 4 })
  remainingQty!: string;

  @Column({ name: 'unit_cost', type: 'numeric', precision: 15, scale: 4 })
  unitCost!: string;

  @Column({ name: 'source_movement_id', type: 'uuid', nullable: true })
  sourceMovementId!: string | null;

  @ManyToOne(() => InventoryMovementEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_movement_id' })
  sourceMovement!: InventoryMovementEntity | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
