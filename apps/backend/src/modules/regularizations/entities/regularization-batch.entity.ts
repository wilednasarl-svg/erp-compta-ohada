import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { RegularizationBatchStatus } from '../types/regularization.types';
import { RegularizationEntryEntity } from './regularization-entry.entity';

/**
 * `regularization_batches` row — voir migration 0096.
 *
 * Un batch regroupe N entrées de régularisation (CCA/PCA/CAP/PAR) saisies
 * en fin d'exercice. À l'exécution, le service produit UNE écriture
 * comptable agrégée dans le journal OD. Au 01/01 N+1 (ou via la méthode
 * `reverseBatch`), une seconde écriture symétrique extourne le tout.
 *
 * Cycle de vie :
 *   draft → executed → reversed
 *     ↓
 *   cancelled (seulement depuis draft)
 *
 * `reversalDate` est calculé automatiquement = `exerciseEndDate` + 1 jour.
 * `journalEntryId` et `reversalJournalEntryId` pointent (FK SET NULL)
 * vers les écritures générées. Pas de CASCADE pour préserver la piste
 * d'audit : si on devait un jour supprimer une écriture (interdit en
 * SYSCOHADA), le batch garderait sa référence à NULL.
 */
@Entity({ name: 'regularization_batches' })
@Index('ix_regularization_batches_org_status', ['organizationId', 'status'])
@Index('ix_regularization_batches_org_exercise', ['organizationId', 'exerciseEndDate'])
export class RegularizationBatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ type: 'text' })
  label!: string;

  @Column({ name: 'exercise_end_date', type: 'date' })
  exerciseEndDate!: string;

  @Column({ name: 'reversal_date', type: 'date' })
  reversalDate!: string;

  @Column({ type: 'text', default: 'draft' })
  status!: RegularizationBatchStatus;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ name: 'reversal_journal_entry_id', type: 'uuid', nullable: true })
  reversalJournalEntryId!: string | null;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt!: Date | null;

  @Column({ name: 'executed_by_id', type: 'uuid', nullable: true })
  executedById!: string | null;

  @Column({ name: 'reversed_at', type: 'timestamptz', nullable: true })
  reversedAt!: Date | null;

  @Column({ name: 'reversed_by_id', type: 'uuid', nullable: true })
  reversedById!: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => RegularizationEntryEntity, (entry) => entry.batch, {
    cascade: false,
  })
  entries!: RegularizationEntryEntity[];
}
