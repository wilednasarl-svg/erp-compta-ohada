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
@Index('ix_brm_stline_entryline', ['bankStatementLineId', 'journalEntryLineId'])
@Index('ix_brm_org_statement_line', ['organizationId', 'bankStatementLineId'])
@Index('ix_brm_org_entry_line', ['organizationId', 'journalEntryLineId'])
@Index('ix_brm_match_group_id', ['matchGroupId'])
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

  /**
   * UUID partagé entre toutes les rows d'un même groupe 1:N (une ligne
   * de relevé liée à plusieurs lignes d'écriture). NULL en 1:1.
   */
  @Column({ name: 'match_group_id', type: 'uuid', nullable: true })
  matchGroupId!: string | null;

  /**
   * Taux de change appliqué (devise compte bancaire → devise comptable)
   * lorsque les devises diffèrent. NULL en mono-devise.
   * NUMERIC(20,10) → string en TypeORM pour préserver la précision.
   */
  @Column({
    name: 'fx_rate_applied',
    type: 'numeric',
    precision: 20,
    scale: 10,
    nullable: true,
  })
  fxRateApplied!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
