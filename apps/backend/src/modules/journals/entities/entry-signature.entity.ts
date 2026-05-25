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
import { JournalEntryEntity } from './journal-entry.entity';

/**
 * Module 14 — rôles autorisés à signer une écriture journal.
 *
 *   - `chef_mission`     : signature de revue (permission `journals.review`).
 *   - `expert_comptable` : signature finale (permission `journals.sign`),
 *                          déclenche le passage de l'entry en `validated`
 *                          et le verrouillage du workflow Module 6.
 */
export type EntrySignerRole = 'chef_mission' | 'expert_comptable';

/**
 * `entry_signatures` row — voir migration 0055.
 *
 * Trace immuable de chaque signature électronique apposée sur une
 * écriture journal. UNIQUE (`journal_entry_id`, `signer_role`) en base
 * garantit qu'un seul `chef_mission` et un seul `expert_comptable`
 * peuvent signer une entry donnée. La colonne `signature_hash`
 * (SHA-256 hex, 64 chars) gèle une projection canonique de l'entry au
 * moment de la signature : toute mutation ultérieure de l'entry
 * (impossible une fois `validated`) serait détectable en rejouant le
 * calcul.
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
  signerRole!: EntrySignerRole;

  @Column({ name: 'signature_hash', type: 'text' })
  signatureHash!: string;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @CreateDateColumn({ name: 'signed_at', type: 'timestamptz' })
  signedAt!: Date;
}
