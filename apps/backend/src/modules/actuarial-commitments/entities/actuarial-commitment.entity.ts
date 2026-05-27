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
import type {
  ActuarialCommitmentStatus,
  ActuarialCommitmentType,
} from '../types/actuarial-commitment.types';

/**
 * `actuarial_commitments` row — voir migration 0109.
 *
 * Une ligne = une évaluation actuarielle pour un type d'engagement
 * (retraite IFC, médaille du travail, préavis légal, autre). Les
 * montants sont stockés en NUMERIC(15,2) → exposés en string pour
 * préserver la précision décimale (convention du projet).
 *
 * Le « hors bilan » est dérivé en service comme `obligation - provisioned`
 * — pas de generated column pour rester portable et tester sans seed SQL.
 */
@Entity({ name: 'actuarial_commitments' })
@Index('ix_actuarial_commitments_org_status', ['organizationId', 'status'])
@Index('ix_actuarial_commitments_org_type', ['organizationId', 'commitmentType'])
@Index('ix_actuarial_commitments_valuation_date', ['valuationDate'])
export class ActuarialCommitmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'commitment_type', type: 'text' })
  commitmentType!: ActuarialCommitmentType;

  @Column({ type: 'text' })
  label!: string;

  @Column({ name: 'valuation_date', type: 'date' })
  valuationDate!: string;

  @Column({ name: 'obligation_amount', type: 'numeric', precision: 15, scale: 2 })
  obligationAmount!: string;

  @Column({
    name: 'provisioned_amount',
    type: 'numeric',
    precision: 15,
    scale: 2,
    default: 0,
  })
  provisionedAmount!: string;

  @Column({ name: 'discount_rate', type: 'numeric', precision: 5, scale: 4 })
  discountRate!: string;

  @Column({ name: 'mortality_table', type: 'text' })
  mortalityTable!: string;

  @Column({ name: 'staff_turnover', type: 'numeric', precision: 5, scale: 4, nullable: true })
  staffTurnover!: string | null;

  @Column({
    name: 'salary_growth_rate',
    type: 'numeric',
    precision: 5,
    scale: 4,
    nullable: true,
  })
  salaryGrowthRate!: string | null;

  @Column({ type: 'text' })
  methodology!: string;

  @Column({ name: 'actuary_name', type: 'text', nullable: true })
  actuaryName!: string | null;

  @Column({ type: 'text', default: 'active' })
  status!: ActuarialCommitmentStatus;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
