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
import type { JournalKind } from '../types/journal.types';

/**
 * `journals` row — voir migrations 0037 + 0093.
 *
 * Catalogue par organisation. 6 journaux SYSCOHADA standards seedés à la
 * création (AC, VE, BQ, CA, OD, PA). Les sous-journaux personnalisés (ex
 * `BQ-01`, `BQ-02`) gardent le `kind` du journal parent.
 */
@Entity({ name: 'journals' })
@Index('ix_journals_org_kind', ['organizationId', 'kind'])
@Index('uq_journals_org_code', ['organizationId', 'code'], { unique: true })
export class JournalEntity {
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

  @Column({ type: 'text' })
  kind!: JournalKind;

  @Column({ name: 'next_entry_number', type: 'integer', default: 1 })
  nextEntryNumber!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'default_account_id', type: 'uuid', nullable: true })
  defaultAccountId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
