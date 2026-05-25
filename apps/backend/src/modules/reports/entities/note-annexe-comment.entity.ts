import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { OrganizationEntity } from '../../organizations/entities/organization.entity';

/**
 * `note_annexe_comments` — voir migration 0091.
 *
 * Persiste les saisies libres du comptable pour les Notes annexes
 * SYSCOHADA (W2.4) :
 *   - commentaire libre par note (texte court ou paragraphe)
 *   - flag `applicable` pour marquer une note "N/A" sur l'exercice
 *
 * Unicité (organization, exercise, noteId) : un seul commentaire par
 * note et par exercice. L'exercice est référencé par son `id` dans
 * `accounting_periods` (où `type = 'annual'`).
 */
@Entity({ name: 'note_annexe_comments' })
@Unique('uq_note_annexe_comments_org_exercise_note', ['organizationId', 'exerciseId', 'noteId'])
@Index('ix_note_annexe_comments_org_exercise', ['organizationId', 'exerciseId'])
export class NoteAnnexeCommentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'exercise_id', type: 'uuid' })
  exerciseId!: string;

  @Column({ name: 'note_id', type: 'varchar', length: 8 })
  noteId!: string;

  @Column({ name: 'comment_text', type: 'text', default: '' })
  commentText!: string;

  @Column({ type: 'boolean', default: true })
  applicable!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
