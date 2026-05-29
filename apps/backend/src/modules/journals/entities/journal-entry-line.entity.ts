import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { OrganizationAccountEntity } from '../../accounting-plan/entities/organization-account.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { JournalEntryEntity } from './journal-entry.entity';

/**
 * `journal_entry_lines` row — voir migration 0039.
 *
 * Une ligne mouvemente UN compte du plan comptable, EXACTEMENT d'un seul
 * côté (débit OU crédit). L'invariant `SUM(debit) = SUM(credit)` par entry
 * est garanti par le service (`EntriesService.createDraft / validate`) et
 * par le trigger PG `tg_check_journal_entry_balance` (migration 0040).
 *
 * Les montants sont stockés en `DECIMAL(15,2)` côté PG et exposés comme
 * `string` en TypeScript pour éviter toute perte de précision (cf. design
 * D1). Les services convertissent via le helper `parseDecimal` / `toDecimalString`.
 */
@Entity({ name: 'journal_entry_lines' })
@Index('ix_journal_entry_lines_entry_position', ['journalEntryId', 'position'])
@Index('ix_journal_entry_lines_org_account', ['organizationId', 'accountId'])
export class JournalEntryLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'journal_entry_id', type: 'uuid' })
  journalEntryId!: string;

  @ManyToOne(() => JournalEntryEntity, (entry) => entry.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry!: JournalEntryEntity;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @ManyToOne(() => OrganizationAccountEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_id' })
  account!: OrganizationAccountEntity;

  @Column({ type: 'integer' })
  position!: number;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // DECIMAL(15,2) — TypeORM lit/écrit en string pour préserver la précision.
  @Column({ type: 'numeric', precision: 15, scale: 2, default: 0 })
  debit!: string;

  @Column({ type: 'numeric', precision: 15, scale: 2, default: 0 })
  credit!: string;

  @Column({ name: 'line_letter', type: 'varchar', length: 4, nullable: true })
  lineLetter!: string | null;

  // Backref to a `partner_letterings` row when this line was reconciled.
  // ON DELETE SET NULL — breaking a lettering at the DB level just
  // unlets the lines. NULL = unlettered.
  @Column({ name: 'lettering_id', type: 'uuid', nullable: true })
  letteringId!: string | null;

  // Axes analytiques — Option A (1 axe par ligne). Migration 0092.
  // Convention applicative : (type IS NULL) = (code IS NULL).
  @Column({ name: 'analytic_axis_type', type: 'varchar', length: 30, nullable: true })
  analyticAxisType!: string | null;

  @Column({ name: 'analytic_axis_code', type: 'varchar', length: 50, nullable: true })
  analyticAxisCode!: string | null;

  // Métadonnées de pièce portées par l'import journal (Migration 0110).
  // Toutes optionnelles : N° facture (lettrage par facture), date
  // d'échéance (échéancier), code taxe (ventilation TVA) et référence
  // libre de ligne (distincte de la référence d'écriture = N° pièce).
  @Column({ name: 'invoice_number', type: 'varchar', length: 50, nullable: true })
  invoiceNumber!: string | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ name: 'tax_code', type: 'varchar', length: 20, nullable: true })
  taxCode!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  reference!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
