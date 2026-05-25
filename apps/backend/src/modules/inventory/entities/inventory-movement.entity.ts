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
import type { MovementType } from '../types/inventory.types';
import { InventoryItemEntity } from './inventory-item.entity';

/**
 * `inventory_movements` row — voir migration 0067.
 *
 * Journal append-only des mouvements de stock. Une ligne = un fait
 * comptable (entrée, sortie, ajustement, inventaire physique). On
 * stocke à la fois :
 *
 *   - le delta {qty, unitPrice} qui a déclenché le mouvement,
 *   - le snapshot {qtyAfter, cmpAfter} APRÈS application de la formule
 *     CMP — ça permet le drill-down "quel était le stock à telle date"
 *     sans replay, et la cohérence FK avec l'écriture comptable wave 2.
 *
 * `journal_entry_id` est nullable en wave 1 (génération écriture en
 * wave 2). Quand renseigné, il pointe vers une `journal_entries` valide
 * de Module 8 dont le `source_type = 'inventory'` (à ajouter à la
 * CHECK union du Module 8 en wave 2).
 *
 * Mouvements jamais modifiés ni supprimés : pour corriger, on saisit
 * un nouveau mouvement (ajustement compensateur).
 */
@Entity({ name: 'inventory_movements' })
@Index('ix_inventory_movements_item_date', ['itemId', 'movementDate'])
@Index('ix_inventory_movements_org_type_date', ['organizationId', 'type', 'movementDate'])
export class InventoryMovementEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId!: string;

  @ManyToOne(() => InventoryItemEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'item_id' })
  item!: InventoryItemEntity;

  @Column({ type: 'text' })
  type!: MovementType;

  @Column({ name: 'movement_date', type: 'date' })
  movementDate!: string;

  /**
   * Pour purchase / sale / production : qty positive.
   * Pour adjustment : peut être négative (delta_qty).
   * Pour inventory_count : qty physique constatée (toujours >= 0).
   */
  @Column({ type: 'numeric', precision: 15, scale: 4 })
  qty!: string;

  /** Prix unitaire à l'entrée. NULL pour sale/inventory_count (sortie au CMP). */
  @Column({ name: 'unit_price', type: 'numeric', precision: 15, scale: 4, nullable: true })
  unitPrice!: string | null;

  /** Quantité totale en stock APRÈS application du mouvement. */
  @Column({ name: 'qty_after', type: 'numeric', precision: 15, scale: 4 })
  qtyAfter!: string;

  /** CMP APRÈS application du mouvement. */
  @Column({ name: 'cmp_after', type: 'numeric', precision: 15, scale: 4 })
  cmpAfter!: string;

  /** Valeur signée du mouvement (positive = entrée, négative = sortie). */
  @Column({ name: 'movement_value', type: 'numeric', precision: 15, scale: 2 })
  movementValue!: string;

  /** Référence libre vers le document source (ex: "FACT-2026-042"). */
  @Column({ name: 'reference', type: 'text', nullable: true })
  reference!: string | null;

  /** Mémo libre saisi par le comptable. */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** FK vers `journal_entries.id` quand l'écriture comptable est postée (wave 2). */
  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
