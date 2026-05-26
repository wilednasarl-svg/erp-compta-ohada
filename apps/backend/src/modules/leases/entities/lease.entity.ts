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
import type { LeaseFrequency, LeaseStatus } from '../types/lease.types';

/**
 * `leases` row — voir migration 0099.
 *
 * Un crédit-bail / contrat de location-acquisition. Le taux implicite
 * est calculé par bisection à la création (cf. `ImplicitRateCalculator`)
 * et stocké en NUMERIC(7,5) — 5 décimales = précision 0.001 %.
 *
 * Les montants en NUMERIC(15,2) sont exposés comme `string` côté
 * TypeORM pour préserver la précision décimale.
 */
@Entity({ name: 'leases' })
@Index('ix_leases_org_status', ['organizationId', 'status'])
@Index('ix_leases_org_asset', ['organizationId', 'assetId'])
export class LeaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'asset_id', type: 'uuid', nullable: true })
  assetId!: string | null;

  @Column({ name: 'contract_ref', type: 'text' })
  contractRef!: string;

  @Column({ name: 'lessor_name', type: 'text' })
  lessorName!: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  @Column({ name: 'fair_value', type: 'numeric', precision: 15, scale: 2 })
  fairValue!: string;

  @Column({ name: 'nominal_total_amount', type: 'numeric', precision: 15, scale: 2 })
  nominalTotalAmount!: string;

  @Column({ name: 'implicit_rate', type: 'numeric', precision: 7, scale: 5 })
  implicitRate!: string;

  @Column({
    name: 'purchase_option_amount',
    type: 'numeric',
    precision: 15,
    scale: 2,
    default: 0,
  })
  purchaseOptionAmount!: string;

  @Column({ type: 'text' })
  frequency!: LeaseFrequency;

  @Column({ name: 'number_of_installments', type: 'int' })
  numberOfInstallments!: number;

  @Column({ type: 'text', default: 'active' })
  status!: LeaseStatus;

  @Column({ name: 'journal_entry_id_initial', type: 'uuid', nullable: true })
  journalEntryIdInitial!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
