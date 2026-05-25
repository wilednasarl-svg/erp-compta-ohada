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

import { UserEntity } from '../../auth/entities/user.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { CollaborationStatus } from '../types/collaboration-status';
import { CollaborationCommentEntity } from './collaboration-comment.entity';

/**
 * `CollaborationRequestEntity` — voir migration 0078.
 *
 * Une demande de justificatif émise par un membre du cabinet (requester)
 * vers un utilisateur (assignee, en général un client). Une demande peut
 * être rattachée à une écriture comptable (`linked_entry_id`) ou à un
 * document existant (`linked_document_id`) pour donner un contexte
 * comptable précis, ou rester libre (les deux à null pour une demande
 * générale type « envoyez-moi le contrat de bail »).
 *
 * Les FK vers `journal_entries` / `documents` sont nullable et ON DELETE
 * SET NULL : on ne veut pas qu'une suppression / soft-delete côté docs
 * fasse disparaître l'historique des échanges. Le contexte reste lisible
 * (titre + description) même si la pièce d'origine n'existe plus.
 *
 * `assignee_id` est nullable : une demande peut être créée sans assignée
 * désignée (broadcast à tous les contacts client de l'org). Lorsqu'un
 * assignee est défini, le filtrage `listForActor` côté client s'appuie
 * dessus pour ne montrer à l'utilisateur que ce qui le concerne.
 *
 * Le status flow est contrôlé par `CollaborationRequestsService.updateStatus`
 * via `isStatusTransitionAllowed`. La CHECK SQL ne valide que l'énumération
 * — pas les transitions — pour permettre une migration/seed de cas
 * historiques sans débloquer la table.
 */
@Entity({ name: 'collaboration_requests' })
@Index('ix_collab_requests_org_status_created', ['organizationId', 'status', 'createdAt'])
@Index('ix_collab_requests_org_assignee', ['organizationId', 'assigneeId'])
@Index('ix_collab_requests_org_requester', ['organizationId', 'requesterId'])
@Index('ix_collab_requests_linked_entry', ['linkedEntryId'])
@Index('ix_collab_requests_linked_document', ['linkedDocumentId'])
export class CollaborationRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'requester_id', type: 'uuid' })
  requesterId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requester_id' })
  requester!: UserEntity;

  @Column({ name: 'assignee_id', type: 'uuid', nullable: true })
  assigneeId!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assignee_id' })
  assignee!: UserEntity | null;

  @Column({ type: 'text', default: 'open' })
  status!: CollaborationStatus;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /**
   * FK lâche vers `journal_entries.id`. Pas de relation TypeORM ici :
   * l'historique doit pouvoir continuer à pointer une écriture même si
   * elle est contre-passée ou si la table change de owning-module
   * (Module 4 vs futur split). La FK SQL est ON DELETE SET NULL.
   */
  @Column({ name: 'linked_entry_id', type: 'uuid', nullable: true })
  linkedEntryId!: string | null;

  /**
   * FK lâche vers `documents.id`. Même raisonnement que ci-dessus :
   * on garde le commentaire/historique même si le document est
   * soft-deleted.
   */
  @Column({ name: 'linked_document_id', type: 'uuid', nullable: true })
  linkedDocumentId!: string | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'completed_by', type: 'uuid', nullable: true })
  completedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => CollaborationCommentEntity, (comment) => comment.request)
  comments!: CollaborationCommentEntity[];
}
