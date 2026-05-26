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

import { AssetEntity } from '../../assets/entities/asset.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { SubsidyReleaseMethod, SubsidyStatus } from '../types/subsidy.types';

/**
 * `subsidies` row — voir migration 0098.
 *
 * Registre d'une subvention d'investissement reçue. Le total octroyé est
 * immuable ; seul `releasedAmount` évolue au fur et à mesure des reprises
 * comptables au résultat (compte 799). Quand `releasedAmount` atteint
 * `totalAmount`, le service bascule `status='fully_released'`.
 *
 * Montants NUMERIC(15,2) exposés en `string` (préservation décimale).
 */
@Entity({ name: 'subsidies' })
@Index('ix_subsidies_org_status', ['organizationId', 'status'])
@Index('ix_subsidies_org_asset', ['organizationId', 'assetId'])
export class SubsidyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'asset_id', type: 'uuid', nullable: true })
  assetId!: string | null;

  @ManyToOne(() => AssetEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'asset_id' })
  asset!: AssetEntity | null;

  @Column({ name: 'grantor_name', type: 'text' })
  grantorName!: string;

  @Column({ name: 'grant_date', type: 'date' })
  grantDate!: string;

  @Column({ name: 'total_amount', type: 'numeric', precision: 15, scale: 2 })
  totalAmount!: string;

  @Column({
    name: 'released_amount',
    type: 'numeric',
    precision: 15,
    scale: 2,
    default: 0,
  })
  releasedAmount!: string;

  @Column({ name: 'release_method', type: 'text' })
  releaseMethod!: SubsidyReleaseMethod;

  @Column({ type: 'text', default: 'active' })
  status!: SubsidyStatus;

  @Column({ name: 'journal_entry_id_grant', type: 'uuid', nullable: true })
  journalEntryIdGrant!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
