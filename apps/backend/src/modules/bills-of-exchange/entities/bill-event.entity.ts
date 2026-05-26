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
import type { BillEventType } from '../types/bill.types';
import { BillOfExchangeEntity } from './bill-of-exchange.entity';

/**
 * `bill_events` row — voir migration 0100.
 *
 * Journal append-only des evenements survenus sur un effet :
 *   - `issuance`      : emission/acceptation (D 412/C 411 ou D 401/C 402)
 *   - `discount`      : escompte bancaire (effet a recevoir uniquement)
 *                       D 5121 net + D 6745 escompte + D 6312 frais /
 *                       C 415 nominal
 *   - `payment`       : encaissement/decaissement a l'echeance
 *   - `unpaid_return` : retour impaye, bascule en clients douteux
 *
 * `journalEntryId` est NULLABLE (theoriquement chaque evenement genere
 * une ecriture, mais on conserve la possibilite de tracer un evenement
 * informatif sans contrepartie comptable).
 *
 * `organizationId` est denormalise pour permettre une RLS / un index
 * tenant-scope sans avoir a join via `bills_of_exchange`.
 */
@Entity({ name: 'bill_events' })
@Index('ix_bill_events_bill', ['billId', 'eventDate', 'createdAt'])
@Index('ix_bill_events_org_type', ['organizationId', 'eventType', 'eventDate'])
export class BillEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'bill_id', type: 'uuid' })
  billId!: string;

  @ManyToOne(() => BillOfExchangeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bill_id' })
  bill!: BillOfExchangeEntity;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'event_type', type: 'text' })
  eventType!: BillEventType;

  @Column({ name: 'event_date', type: 'date' })
  eventDate!: string;

  @Column({ type: 'numeric', precision: 15, scale: 2 })
  amount!: string;

  @Column({ name: 'discount_fee', type: 'numeric', precision: 15, scale: 2, nullable: true })
  discountFee!: string | null;

  @Column({ name: 'bank_fee', type: 'numeric', precision: 15, scale: 2, nullable: true })
  bankFee!: string | null;

  @Column({ name: 'net_amount', type: 'numeric', precision: 15, scale: 2, nullable: true })
  netAmount!: string | null;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
