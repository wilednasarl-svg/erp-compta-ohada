import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { InventoryItemEntity } from '../../inventory/entities/inventory-item.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { ImpairmentType } from '../types/impairment.types';

/**
 * `inventory_impairments` row — voir migration 0097.
 *
 * Une ligne par test NRV (Net Realizable Value) effectué sur un article
 * de stock. `carryingAmount` = CMUP × Qté à la date du test. `nrv` est
 * saisi par l'utilisateur (souvent valeur de marché diminuée des frais
 * de commercialisation, cf. SYSCOHADA chap. 14).
 */
@Entity({ name: 'inventory_impairments' })
@Index('ix_inventory_impairments_org_item', ['organizationId', 'inventoryItemId', 'testDate'])
@Index('ix_inventory_impairments_org_date', ['organizationId', 'testDate'])
export class InventoryImpairmentEntity {
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
  inventoryItem!: InventoryItemEntity;

  @Column({ name: 'test_date', type: 'date' })
  testDate!: string;

  @Column({ name: 'carrying_amount', type: 'numeric', precision: 15, scale: 2 })
  carryingAmount!: string;

  @Column({ name: 'nrv', type: 'numeric', precision: 15, scale: 2 })
  nrv!: string;

  @Column({ name: 'impairment_amount', type: 'numeric', precision: 15, scale: 2 })
  impairmentAmount!: string;

  @Column({ type: 'text' })
  type!: ImpairmentType;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
