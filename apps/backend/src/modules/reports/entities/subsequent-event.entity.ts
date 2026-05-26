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

/**
 * Classification SYSCOHADA Tome 3 / Note 35 d'un événement postérieur à
 * la clôture.
 *
 *   - `ADJUSTING`     : l'événement apporte une INFORMATION sur une
 *     situation pré-existante à la date de clôture (ex. issue d'un
 *     contentieux dont la provision était sous-estimée). Doit être
 *     comptabilisé sur l'exercice clos avant arrêté.
 *   - `NON_ADJUSTING` : situation née APRÈS la clôture (ex. incendie
 *     d'un entrepôt en janvier de l'exercice suivant). Simple
 *     disclosure en Note 35, pas de retraitement des comptes.
 */
export type SubsequentEventClassification = 'ADJUSTING' | 'NON_ADJUSTING';

export const SUBSEQUENT_EVENT_CLASSIFICATIONS: ReadonlyArray<SubsequentEventClassification> = [
  'ADJUSTING',
  'NON_ADJUSTING',
];

/**
 * `subsequent_events` — voir migration 0102.
 *
 * Événements survenus entre la date de clôture d'un exercice et la
 * date d'arrêté des comptes. Source structurée du remplissage de la
 * Note 35 (qui peut sinon n'être qu'un texte libre).
 */
@Entity({ name: 'subsequent_events' })
@Index('ix_subsequent_events_org_exercise', ['organizationId', 'exerciseId', 'eventDate'])
export class SubsequentEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'exercise_id', type: 'uuid' })
  exerciseId!: string;

  @Column({ name: 'event_date', type: 'date' })
  eventDate!: string;

  @Column({ type: 'text' })
  classification!: SubsequentEventClassification;

  @Column({ type: 'text' })
  description!: string;

  @Column({ name: 'financial_impact', type: 'numeric', precision: 15, scale: 2, nullable: true })
  financialImpact!: string | null;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById!: string;

  @Column({ name: 'reviewed_by_id', type: 'uuid', nullable: true })
  reviewedById!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
