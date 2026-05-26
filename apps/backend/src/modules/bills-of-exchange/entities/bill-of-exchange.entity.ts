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
import type { BillKind, BillStatus } from '../types/bill.types';

/**
 * `bills_of_exchange` row — voir migration 0100.
 *
 * Une ligne par effet de commerce (traite ou billet a ordre) emis ou
 * accepte. Le champ `currentLocationAccount` materialise le compte
 * SYSCOHADA ou l'effet reside actuellement (412, 415 ou 402) — il
 * change au fil des transitions (escompte, paiement, impaye).
 *
 * `originalJournalEntryId` pointe vers l'ecriture d'emission afin de
 * permettre une remontee comptable rapide a partir de l'effet. Les
 * ecritures suivantes (escompte, paiement, impaye) sont liees a
 * travers les `BillEventEntity`.
 *
 * Comme pour les autres modules (assets, provisions, impairments) les
 * montants NUMERIC(15,2) sont exposes en `string` cote TypeORM pour
 * preserver la precision decimale.
 */
@Entity({ name: 'bills_of_exchange' })
@Index('ix_bills_of_exchange_org_status', ['organizationId', 'status'])
@Index('ix_bills_of_exchange_org_due_date', ['organizationId', 'dueDate'])
export class BillOfExchangeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ type: 'text' })
  kind!: BillKind;

  @Column({ name: 'partner_account_code', type: 'text' })
  partnerAccountCode!: string;

  @Column({ name: 'partner_name', type: 'text' })
  partnerName!: string;

  @Column({ name: 'bill_number', type: 'text' })
  billNumber!: string;

  @Column({ name: 'issue_date', type: 'date' })
  issueDate!: string;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @Column({ name: 'nominal_amount', type: 'numeric', precision: 15, scale: 2 })
  nominalAmount!: string;

  @Column({ type: 'text', default: 'issued' })
  status!: BillStatus;

  @Column({ name: 'current_location_account', type: 'text' })
  currentLocationAccount!: string;

  @Column({ name: 'original_journal_entry_id', type: 'uuid', nullable: true })
  originalJournalEntryId!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
