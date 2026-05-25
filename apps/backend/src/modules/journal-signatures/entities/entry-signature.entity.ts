import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { JournalEntryEntity } from '../../journals/entities/journal-entry.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { SignerRole } from '../types/journal-signature.types';

/**
 * `entry_signatures` row — voir migration 0055.
 *
 * Trace immuable de chaque signature électronique sur une écriture journal.
 * Le couple (`journal_entry_id`, `signer_role`) est unique : une signature
 * par rôle par entry. Le `signature_hash` (SHA-256 hex) est calculé sur
 * une projection canonique de l'entry au moment de la signature.
 */
@Entity({ name: 'entry_signatures' })
@Index('ix_entry_signatures_org_entry', ['organizationId', 'journalEntryId'])
@Index('ix_entry_signatures_org_signer', ['organizationId', 'signerId', 'signedAt'])
export class EntrySignatureEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'journal_entry_id', type: 'uuid' })
  journalEntryId!: string;

  @ManyToOne(() => JournalEntryEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry!: JournalEntryEntity;

  @Column({ name: 'signer_id', type: 'uuid' })
  signerId!: string;

  @Column({ name: 'signer_role', type: 'text' })
  signerRole!: SignerRole;

  @Column({ name: 'signature_hash', type: 'text' })
  signatureHash!: string;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @CreateDateColumn({ name: 'signed_at', type: 'timestamptz' })
  signedAt!: Date;
}
