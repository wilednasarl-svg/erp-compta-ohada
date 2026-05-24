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
import type { DepreciationStatus } from '../types/asset.types';
import { AssetEntity } from './asset.entity';

/**
 * `depreciation_schedules` row — voir migration 0047.
 *
 * Une ligne par exercice fiscal et par immobilisation. Calculé une fois
 * à la création de l'asset (lookup déterministe sur la méthode + la
 * durée + la date de mise en service) ; régénéré uniquement si la
 * définition métier de l'asset change.
 *
 * Un schedule `pending` peut être supprimé (régénération) ou posté en
 * écriture comptable (`postPeriod`). Un schedule `posted` est immuable :
 * il porte `journal_entry_id` pointant vers la `journal_entries`
 * créée par `EntriesService.createDraft({sourceType: 'depreciation'})`
 * puis validée. Pour annuler, il faut contre-passer l'écriture (Module 8)
 * — le schedule reste `posted`, l'écriture passe en `cancelled`.
 */
@Entity({ name: 'depreciation_schedules' })
@Index('uq_depreciation_schedules_asset_year', ['assetId', 'fiscalYear'], { unique: true })
@Index('ix_depreciation_schedules_org_year_status', [
  'organizationId',
  'fiscalYear',
  'status',
])
export class DepreciationScheduleEntity {
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

  @Column({ name: 'fiscal_year', type: 'integer' })
  fiscalYear!: number;

  @Column({ name: 'period_start', type: 'date' })
  periodStart!: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd!: string;

  @Column({
    name: 'depreciation_amount',
    type: 'numeric',
    precision: 15,
    scale: 2,
  })
  depreciationAmount!: string;

  @Column({
    name: 'cumulative_depreciation',
    type: 'numeric',
    precision: 15,
    scale: 2,
  })
  cumulativeDepreciation!: string;

  @Column({
    name: 'net_book_value',
    type: 'numeric',
    precision: 15,
    scale: 2,
  })
  netBookValue!: string;

  @Column({ type: 'text', default: 'pending' })
  status!: DepreciationStatus;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt!: Date | null;

  @Column({ name: 'posted_by_id', type: 'uuid', nullable: true })
  postedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
