import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { UserEntity } from '../../auth/entities/user.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { CollaborationRequestEntity } from './collaboration-request.entity';

/**
 * `CollaborationCommentEntity` — voir migration 0079.
 *
 * Message attaché à une demande de justificatif. Cabinet et client
 * écrivent dans la même table ; le `author_id` (+ rôle au moment de
 * l'envoi, dénormalisé dans `metadata` audit) suffit à reconstituer
 * la conversation.
 *
 * Pas de soft-delete en wave 1 : une fois posté, un commentaire est
 * immutable. L'édition / suppression seront introduites en wave 2 via
 * `deleted_at` + une nouvelle permission `collaboration.moderate`.
 *
 * `organization_id` est dénormalisé pour que la garde multi-tenant
 * (`assertTenantId`) puisse filtrer SANS jointure avec
 * `collaboration_requests`.
 */
@Entity({ name: 'collaboration_comments' })
@Index('ix_collab_comments_request_created', ['requestId', 'createdAt'])
@Index('ix_collab_comments_org_author', ['organizationId', 'authorId'])
export class CollaborationCommentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  @ManyToOne(() => CollaborationRequestEntity, (request) => request.comments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'request_id' })
  request!: CollaborationRequestEntity;

  @Column({ name: 'author_id', type: 'uuid' })
  authorId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'author_id' })
  author!: UserEntity;

  @Column({ type: 'text' })
  body!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
