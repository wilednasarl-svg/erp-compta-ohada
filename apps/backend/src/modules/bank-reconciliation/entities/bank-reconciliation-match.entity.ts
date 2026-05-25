import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { JournalEntryLineEntity } from '../../journals/entities/journal-entry-line.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { BankMatchMethod } from '../types/bank.types';
import { BankStatementLineEntity } from './bank-statement-line.entity';

@Entity({ name: 'bank_reconciliation_matches' })
@Index('uq_brm_statement_entry_line', ['bankStatementLineId', 'journalEntryLineId'], {
  unique: true,
})
@Index('ix_brm_org_statement_line', ['organizationId', 'bankStatementLineId'])
@Index('ix_brm_org_entry_line', ['organizationId', 'journalEntryLineId'])
export class BankReconciliationMatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'bank_statement_line_id', type: 'uuid' })
  bankStatementLineId!: string;

  @ManyToOne(() => BankStatementLineEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bank_statement_line_id' })
  bankStatementLine!: BankStatementLineEntity;

  @Column({ name: 'journal_entry_line_id', type: 'uuid' })
  journalEntryLineId!: string;

  @ManyToOne(() => JournalEntryLineEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'journal_entry_line_id' })
  journalEntryLine!: JournalEntryLineEntity;

  @Column({ name: 'match_method', type: 'text' })
  matchMethod!: BankMatchMethod;

  @Column({ name: 'confidence_score', type: 'integer', nullable: true })
  confidenceScore!: number | null;

  @Column({ name: 'matched_by_id', type: 'uuid', nullable: true })
  matchedById!: string | null;

  @Column({ name: 'matched_at', type: 'timestamptz' })
  matchedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
