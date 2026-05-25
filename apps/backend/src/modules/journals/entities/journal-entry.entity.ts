import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { JournalEntryStatus } from '../types/journal.types';
import { AccountingPeriodEntity } from './accounting-period.entity';
import { JournalEntity } from './journal.entity';
import { JournalEntryLineEntity } from './journal-entry-line.entity';

export type JournalEntrySourceType = 'manual' | 'import' | 'depreciation';

/**
 * `journal_entries` row — voir migration 0038.
 *
 * En-tête d'une pièce comptable double-partie. Le détail des montants
 * débit / crédit est porté par `JournalEntryLineEntity`.
 *
 * Cycle de vie : draft → validated → cancelled (via contre-passation).
 */
@Entity({ name: 'journal_entries' })
@Index('ix_journal_entries_org_period', ['organizationId', 'periodId', 'entryDate'])
@Index('ix_journal_entries_org_journal_date', ['organizationId', 'journalId', 'entryDate'])
@Index('ix_journal_entries_org_status', ['organizationId', 'status'])
@Index('uq_journal_entries_org_journal_number', ['organizationId', 'journalId', 'entryNumber'], {
  unique: true,
})
export class JournalEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'journal_id', type: 'uuid' })
  journalId!: string;

  @ManyToOne(() => JournalEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'journal_id' })
  journal!: JournalEntity;

  @Column({ name: 'period_id', type: 'uuid' })
  periodId!: string;

  @ManyToOne(() => AccountingPeriodEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'period_id' })
  period!: AccountingPeriodEntity;

  @Column({ name: 'entry_number', type: 'integer' })
  entryNumber!: number;

  @Column({ name: 'entry_date', type: 'date' })
  entryDate!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'text', nullable: true })
  reference!: string | null;

  @Column({ type: 'text', default: 'draft' })
  status!: JournalEntryStatus;

  @Column({ name: 'cancels_id', type: 'uuid', nullable: true })
  cancelsId!: string | null;

  @ManyToOne(() => JournalEntryEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'cancels_id' })
  cancels?: JournalEntryEntity | null;

  @Column({ name: 'source_type', type: 'text', default: 'manual' })
  sourceType!: JournalEntrySourceType;

  @Column({ name: 'source_import_session_id', type: 'uuid', nullable: true })
  sourceImportSessionId!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'validated_at', type: 'timestamptz', nullable: true })
  validatedAt!: Date | null;

  @Column({ name: 'validated_by_id', type: 'uuid', nullable: true })
  validatedById!: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'cancelled_by_id', type: 'uuid', nullable: true })
  cancelledById!: string | null;

  @Column({ name: 'cancelled_reason', type: 'text', nullable: true })
  cancelledReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => JournalEntryLineEntity, (line) => line.journalEntry, { cascade: ['insert'] })
  lines!: JournalEntryLineEntity[];
}
