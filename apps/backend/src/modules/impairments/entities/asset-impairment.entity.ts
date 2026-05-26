import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { AssetEntity } from '../../assets/entities/asset.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { ImpairmentType } from '../types/impairment.types';

/**
 * `asset_impairments` row — voir migration 0097.
 *
 * Une ligne par test de valeur effectué sur un asset. La table est
 * append-only (pas d'update métier après création) : pour corriger un
 * test on en pose un nouveau. L'historique conserve l'audit comptable.
 *
 * Montants `NUMERIC(15,2)` exposés en `string` (préservation décimale).
 */
@Entity({ name: 'asset_impairments' })
@Index('ix_asset_impairments_org_asset', ['organizationId', 'assetId', 'testDate'])
@Index('ix_asset_impairments_org_date', ['organizationId', 'testDate'])
export class AssetImpairmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  @ManyToOne(() => AssetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id' })
  asset!: AssetEntity;

  @Column({ name: 'test_date', type: 'date' })
  testDate!: string;

  @Column({ name: 'carrying_amount', type: 'numeric', precision: 15, scale: 2 })
  carryingAmount!: string;

  @Column({ name: 'recoverable_amount', type: 'numeric', precision: 15, scale: 2 })
  recoverableAmount!: string;

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
