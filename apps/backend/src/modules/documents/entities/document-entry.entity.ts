import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import { UserEntity } from '../../auth/entities/user.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { DocumentEntity } from './document.entity';

/**
 * `DocumentEntryEntity` — voir migration 0021.
 *
 * n-n pivot between a document and the journal entries it backs.
 * `entry_id` has no FK yet because the journal entries table arrives
 * with Module 3 vague 2 / Module 4. `organization_id` is denormalized
 * on purpose so the multi-tenant invariant is queryable in the
 * meantime (every read filters on it via `assertTenantId`).
 *
 * The composite PK `(documentId, entryId)` makes re-linking idempotent:
 * `INSERT ... ON CONFLICT DO NOTHING` is safe.
 */
@Entity({ name: 'document_entries' })
@Index('ix_document_entries_org_entry', ['organizationId', 'entryId'])
@Index('ix_document_entries_org_document', ['organizationId', 'documentId'])
export class DocumentEntryEntity {
  @PrimaryColumn({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @PrimaryColumn({ name: 'entry_id', type: 'uuid' })
  entryId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => DocumentEntity, (document) => document.entryLinks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'document_id' })
  document!: DocumentEntity;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  creator!: UserEntity;
}
