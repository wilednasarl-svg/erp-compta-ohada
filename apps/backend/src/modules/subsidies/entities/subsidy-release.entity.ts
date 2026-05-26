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
import { SubsidyEntity } from './subsidy.entity';

/**
 * `subsidy_releases` row — voir migration 0098.
 *
 * Trace une reprise comptable de subvention au résultat (D 1411 / C 799).
 * Append-only : pour corriger, on contre-passe l'écriture liée puis on
 * pose une nouvelle ligne. `relatedDepreciationScheduleId` est posé
 * quand la reprise est déclenchée par une dotation d'amortissement
 * (méthode `on_depreciation`).
 */
@Entity({ name: 'subsidy_releases' })
@Index('ix_subsidy_releases_subsidy', ['subsidyId', 'releaseDate'])
@Index('ix_subsidy_releases_org_date', ['organizationId', 'releaseDate'])
export class SubsidyReleaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'subsidy_id', type: 'uuid' })
  subsidyId!: string;

  @ManyToOne(() => SubsidyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subsidy_id' })
  subsidy!: SubsidyEntity;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'release_date', type: 'date' })
  releaseDate!: string;

  @Column({ type: 'numeric', precision: 15, scale: 2 })
  amount!: string;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({
    name: 'related_depreciation_schedule_id',
    type: 'uuid',
    nullable: true,
  })
  relatedDepreciationScheduleId!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
