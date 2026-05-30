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
  FiscalBaseKind,
  FiscalDeclarationKind,
  FiscalPeriodicity,
} from '../types/fiscal.types';

/**
 * `fiscal_parameters` row — voir migration 0113.
 *
 * Taux fiscal/social versionné par date d'effet. `rate` et les plafonds
 * sortent en `string` (NUMERIC) pour préserver la précision.
 */
@Entity({ name: 'fiscal_parameters' })
@Index('uq_fiscal_parameters_org_code_from', ['organizationId', 'taxCode', 'effectiveFrom'], {
  unique: true,
})
@Index('ix_fiscal_parameters_org_code_active', ['organizationId', 'taxCode', 'isActive'])
export class FiscalParameterEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'tax_code', type: 'text' })
  taxCode!: string;

  @Column({ type: 'text' })
  label!: string;

  @Column({ name: 'declaration_kind', type: 'text' })
  declarationKind!: FiscalDeclarationKind;

  @Column({ type: 'numeric', precision: 8, scale: 4, default: 0 })
  rate!: string;

  @Column({ name: 'base_kind', type: 'text' })
  baseKind!: FiscalBaseKind;

  @Column({ type: 'text' })
  periodicity!: FiscalPeriodicity;

  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true })
  ceiling!: string | null;

  @Column({ name: 'floor_amount', type: 'numeric', precision: 18, scale: 2, nullable: true })
  floorAmount!: string | null;

  @Column({ name: 'due_day', type: 'int', default: 15 })
  dueDay!: number;

  @Column({ name: 'charge_account', type: 'text', nullable: true })
  chargeAccount!: string | null;

  @Column({ name: 'liability_account', type: 'text', nullable: true })
  liabilityAccount!: string | null;

  @Column({ name: 'effective_from', type: 'date' })
  effectiveFrom!: string;

  @Column({ name: 'effective_to', type: 'date', nullable: true })
  effectiveTo!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
