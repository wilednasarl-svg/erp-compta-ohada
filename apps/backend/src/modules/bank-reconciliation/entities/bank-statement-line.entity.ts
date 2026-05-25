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
import type { BankStatementLineMatchStatus } from '../types/bank.types';
import { BankAccountEntity } from './bank-account.entity';
import { BankStatementEntity } from './bank-statement.entity';

@Entity({ name: 'bank_statement_lines' })
@Index('ix_bank_statement_lines_statement', ['bankStatementId', 'lineOrder'])
@Index('ix_bank_statement_lines_org_account_status', [
  'organizationId',
  'bankAccountId',
  'matchStatus',
])
export class BankStatementLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'bank_statement_id', type: 'uuid' })
  bankStatementId!: string;

  @ManyToOne(() => BankStatementEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bank_statement_id' })
  bankStatement!: BankStatementEntity;

  @Column({ name: 'bank_account_id', type: 'uuid' })
  bankAccountId!: string;

  @ManyToOne(() => BankAccountEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bank_account_id' })
  bankAccount!: BankAccountEntity;

  @Column({ name: 'line_order', type: 'integer' })
  lineOrder!: number;

  @Column({ name: 'operation_date', type: 'date' })
  operationDate!: string;

  @Column({ name: 'value_date', type: 'date', nullable: true })
  valueDate!: string | null;

  @Column({ type: 'text' })
  label!: string;

  @Column({ name: 'bank_reference', type: 'text', nullable: true })
  bankReference!: string | null;

  @Column({ type: 'numeric', precision: 15, scale: 2 })
  amount!: string;

  @Column({ name: 'match_status', type: 'text', default: 'unmatched' })
  matchStatus!: BankStatementLineMatchStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
