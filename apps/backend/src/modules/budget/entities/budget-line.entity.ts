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
import type { BudgetLineStatus, BudgetScenario, BudgetType } from '../types/budget.types';

/**
 * `budget_lines` row — voir migration 0111.
 *
 * Ligne budgétaire atomique : maille la plus fine du modèle
 * (Exercice × Période × Compte SYSCOHADA × axes × Type budget × Scénario).
 *
 * Montants exposés en `string` (NUMERIC) pour préserver la précision.
 * `amountBase` = `amount` × `exchangeRate`, recalculé en service à chaque
 * écriture (consolidation multi-devises au taux budgétaire figé).
 */
@Entity({ name: 'budget_lines' })
@Index('ix_budget_lines_org_year_scenario_type', [
  'organizationId',
  'fiscalYear',
  'scenario',
  'budgetType',
])
@Index('ix_budget_lines_org_year_account', ['organizationId', 'fiscalYear', 'accountCode'])
@Index('ix_budget_lines_org_cost_center', ['organizationId', 'costCenterAxisId'])
@Index('ix_budget_lines_org_project', ['organizationId', 'projectAxisId'])
export class BudgetLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'fiscal_year', type: 'int' })
  fiscalYear!: number;

  /** 1..12 = ligne mensuelle ; NULL = ligne annuelle. */
  @Column({ name: 'period_month', type: 'int', nullable: true })
  periodMonth!: number | null;

  @Column({ name: 'budget_type', type: 'text' })
  budgetType!: BudgetType;

  @Column({ type: 'text', default: 'BI' })
  scenario!: BudgetScenario;

  @Column({ name: 'account_code', type: 'text' })
  accountCode!: string;

  @Column({ name: 'account_label', type: 'text', nullable: true })
  accountLabel!: string | null;

  @Column({ name: 'cost_center_axis_id', type: 'uuid', nullable: true })
  costCenterAxisId!: string | null;

  @Column({ name: 'project_axis_id', type: 'uuid', nullable: true })
  projectAxisId!: string | null;

  @Column({ name: 'agency_axis_id', type: 'uuid', nullable: true })
  agencyAxisId!: string | null;

  @Column({ name: 'product_axis_id', type: 'uuid', nullable: true })
  productAxisId!: string | null;

  // NUMERIC(18,2) — read/write en string pour préserver la précision.
  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  amount!: string;

  @Column({ type: 'text', default: 'XOF' })
  currency!: string;

  @Column({ name: 'exchange_rate', type: 'numeric', precision: 12, scale: 6, default: 1 })
  exchangeRate!: string;

  @Column({ name: 'amount_base', type: 'numeric', precision: 18, scale: 2, default: 0 })
  amountBase!: string;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @Column({ type: 'text', nullable: true })
  hypothesis!: string | null;

  @Column({ type: 'text', default: 'brouillon' })
  status!: BudgetLineStatus;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'validated_by_id', type: 'uuid', nullable: true })
  validatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
