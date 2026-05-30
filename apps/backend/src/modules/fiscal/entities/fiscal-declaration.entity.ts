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
import type { FiscalDeclarationStatus } from '../types/fiscal.types';

/**
 * `fiscal_declarations` row — voir migration 0113.
 *
 * Déclaration générée : base × taux → montant dû, échéancée (`dueDate`) et
 * suivie par statut de dépôt. Le décaissement à l'échéance alimente le
 * budget de trésorerie. Montants en `string` (NUMERIC).
 */
@Entity({ name: 'fiscal_declarations' })
@Index('ix_fiscal_declarations_org_status_due', ['organizationId', 'status', 'dueDate'])
@Index('ix_fiscal_declarations_org_year', ['organizationId', 'periodYear'])
export class FiscalDeclarationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'tax_code', type: 'text' })
  taxCode!: string;

  @Column({ type: 'text', nullable: true })
  label!: string | null;

  @Column({ name: 'period_year', type: 'int' })
  periodYear!: number;

  @Column({ name: 'period_month', type: 'int', nullable: true })
  periodMonth!: number | null;

  @Column({ name: 'base_amount', type: 'numeric', precision: 18, scale: 2, default: 0 })
  baseAmount!: string;

  @Column({ type: 'numeric', precision: 8, scale: 4, default: 0 })
  rate!: string;

  @Column({ name: 'amount_due', type: 'numeric', precision: 18, scale: 2, default: 0 })
  amountDue!: string;

  @Column({ type: 'text', default: 'XOF' })
  currency!: string;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @Column({ type: 'text', default: 'a_deposer' })
  status!: FiscalDeclarationStatus;

  @Column({ type: 'text', nullable: true })
  reference!: string | null;

  @Column({ name: 'justificatif_url', type: 'text', nullable: true })
  justificatifUrl!: string | null;

  @Column({ name: 'charge_account', type: 'text', nullable: true })
  chargeAccount!: string | null;

  @Column({ name: 'liability_account', type: 'text', nullable: true })
  liabilityAccount!: string | null;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'validated_by_id', type: 'uuid', nullable: true })
  validatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
