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

/**
 * `lease_installments` row — voir migration 0099.
 *
 * Tableau d'amortissement pré-calculé à la création du contrat :
 * une ligne par échéance contractuelle. Chaque ligne porte la
 * décomposition intérêts / capital figée par le taux implicite.
 *
 * `paid` bascule à `true` quand un `LeasePaymentEntity` est posé
 * sur l'installment — la liste des paiements reste séparée pour
 * conserver la traçabilité (un paiement n'écrase jamais l'échéance
 * prévisionnelle).
 */
@Entity({ name: 'lease_installments' })
@Index('ix_lease_installments_lease_due', ['leaseId', 'dueDate'])
@Index('ix_lease_installments_org_due', ['organizationId', 'dueDate'])
export class LeaseInstallmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'lease_id', type: 'uuid' })
  leaseId!: string;

  @ManyToOne(() => LeaseEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lease_id' })
  lease!: LeaseEntity;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @Column({ name: 'installment_number', type: 'int' })
  installmentNumber!: number;

  @Column({ name: 'total_amount', type: 'numeric', precision: 15, scale: 2 })
  totalAmount!: string;

  @Column({ name: 'interest_part', type: 'numeric', precision: 15, scale: 2 })
  interestPart!: string;

  @Column({ name: 'capital_part', type: 'numeric', precision: 15, scale: 2 })
  capitalPart!: string;

  @Column({ name: 'outstanding_balance', type: 'numeric', precision: 15, scale: 2 })
  outstandingBalance!: string;

  @Column({ type: 'boolean', default: false })
  paid!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
