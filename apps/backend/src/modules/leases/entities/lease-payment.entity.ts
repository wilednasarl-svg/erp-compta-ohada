import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { LeaseEntity } from './lease.entity';
import { LeaseInstallmentEntity } from './lease-installment.entity';

/**
 * `lease_payments` row — voir migration 0099.
 *
 * Trace d'un paiement effectif d'une échéance. Une ligne par
 * mouvement bancaire constaté. Le `journal_entry_id` lie le paiement
 * à l'écriture D 6724 + D 173 / C 521 générée côté Module 8.
 */
@Entity({ name: 'lease_payments' })
@Index('ix_lease_payments_lease_date', ['leaseId', 'paymentDate'])
@Index('ix_lease_payments_org_date', ['organizationId', 'paymentDate'])
export class LeasePaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'lease_id', type: 'uuid' })
  leaseId!: string;

  @ManyToOne(() => LeaseEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lease_id' })
  lease!: LeaseEntity;

  @Column({ name: 'installment_id', type: 'uuid' })
  installmentId!: string;

  @ManyToOne(() => LeaseInstallmentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'installment_id' })
  installment!: LeaseInstallmentEntity;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'payment_date', type: 'date' })
  paymentDate!: string;

  @Column({ type: 'numeric', precision: 15, scale: 2 })
  amount!: string;

  @Column({ name: 'interest_part', type: 'numeric', precision: 15, scale: 2 })
  interestPart!: string;

  @Column({ name: 'capital_part', type: 'numeric', precision: 15, scale: 2 })
  capitalPart!: string;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
