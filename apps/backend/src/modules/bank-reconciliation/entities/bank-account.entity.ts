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

import { OrganizationAccountEntity } from '../../accounting-plan/entities/organization-account.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { BankAccountStatus } from '../types/bank.types';

@Entity({ name: 'bank_accounts' })
@Index('uq_bank_accounts_org_code', ['organizationId', 'code'], { unique: true })
@Index('ix_bank_accounts_org_status', ['organizationId', 'status'])
export class BankAccountEntity {
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

  @Column({ name: 'bank_name', type: 'text' })
  bankName!: string;

  @Column({ name: 'account_number', type: 'text', nullable: true })
  accountNumber!: string | null;

  @Column({ type: 'text', nullable: true })
  iban!: string | null;

  @Column({ type: 'text', default: 'XOF' })
  currency!: string;

  @Column({ name: 'chart_account_id', type: 'uuid' })
  chartAccountId!: string;

  @ManyToOne(() => OrganizationAccountEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'chart_account_id' })
  chartAccount!: OrganizationAccountEntity;

  @Column({
    name: 'opening_balance',
    type: 'numeric',
    precision: 15,
    scale: 2,
    default: 0,
  })
  openingBalance!: string;

  @Column({ type: 'text', default: 'active' })
  status!: BankAccountStatus;

  @Column({ name: 'last_reconciled_at', type: 'timestamptz', nullable: true })
  lastReconciledAt!: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
