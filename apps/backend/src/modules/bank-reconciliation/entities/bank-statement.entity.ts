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
import type { BankStatementStatus } from '../types/bank.types';
import { BankAccountEntity } from './bank-account.entity';
import { BankStatementLineEntity } from './bank-statement-line.entity';

@Entity({ name: 'bank_statements' })
@Index('ix_bank_statements_org_account_period', ['organizationId', 'bankAccountId', 'periodEnd'])
@Index('ix_bank_statements_org_status', ['organizationId', 'status'])
export class BankStatementEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'bank_account_id', type: 'uuid' })
  bankAccountId!: string;

  @ManyToOne(() => BankAccountEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bank_account_id' })
  bankAccount!: BankAccountEntity;

  @Column({ name: 'period_start', type: 'date' })
  periodStart!: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd!: string;

  @Column({
    name: 'opening_balance',
    type: 'numeric',
    precision: 15,
    scale: 2,
  })
  openingBalance!: string;

  @Column({
    name: 'closing_balance',
    type: 'numeric',
    precision: 15,
    scale: 2,
  })
  closingBalance!: string;

  @Column({ type: 'text', default: 'XOF' })
  currency!: string;

  @Column({ name: 'imported_file_name', type: 'text' })
  importedFileName!: string;

  @Column({ name: 'imported_file_hash', type: 'text' })
  importedFileHash!: string;

  @Column({ name: 'imported_lines_count', type: 'integer', default: 0 })
  importedLinesCount!: number;

  @Column({ name: 'matched_lines_count', type: 'integer', default: 0 })
  matchedLinesCount!: number;

  @Column({ type: 'text', default: 'imported' })
  status!: BankStatementStatus;

  @Column({ name: 'imported_by_id', type: 'uuid', nullable: true })
  importedById!: string | null;

  @Column({ name: 'imported_at', type: 'timestamptz' })
  importedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => BankStatementLineEntity, (line) => line.bankStatement)
  lines!: BankStatementLineEntity[];
}
