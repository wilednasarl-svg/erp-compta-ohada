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
import { BankAccountEntity } from '../../bank-reconciliation/entities/bank-account.entity';

export type CashFlowForecastType = 'inflow' | 'outflow';
export type CashFlowForecastStatus = 'pending' | 'realized' | 'cancelled';

/**
 * Entité pour stocker les prévisions manuelles de trésorerie.
 * Utilisée pour projeter les flux (encaissements/décaissements) à venir.
 */
@Entity({ name: 'cash_flow_forecasts' })
@Index('ix_cff_org_date', ['organizationId', 'expectedDate'])
@Index('ix_cff_org_status', ['organizationId', 'status'])
export class CashFlowForecastEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text' })
  type!: CashFlowForecastType;

  // Decimal pour les montants, stocké en numeric(15,2) comme les écritures
  @Column({ type: 'numeric', precision: 15, scale: 2 })
  amount!: string;

  @Column({ name: 'expected_date', type: 'date' })
  expectedDate!: string;

  @Column({ type: 'text', default: 'pending' })
  status!: CashFlowForecastStatus;

  @Column({ type: 'text', nullable: true })
  category!: string | null;

  @Column({ type: 'text', nullable: true })
  recurrence!: string | null;

  @Column({ name: 'bank_account_id', type: 'uuid', nullable: true })
  bankAccountId!: string | null;

  @ManyToOne(() => BankAccountEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'bank_account_id' })
  bankAccount!: BankAccountEntity | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
