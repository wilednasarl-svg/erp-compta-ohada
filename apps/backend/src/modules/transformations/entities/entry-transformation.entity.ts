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
import { ImportStagingEntryEntity } from '../../imports/entities/import-staging-entry.entity';
import type { TransformationDiff, TransformationStatus, TransformationType } from '../types/transformation.types';

/**
 * `EntryTransformationEntity` — voir migration 0023.
 *
 * Chaque transformation est un artefact SUPPLÉMENTAIRE lié à une
 * écriture source (`import_staging_entries`). La source n'est jamais
 * modifiée (invariant fondamental du module).
 *
 * `beforeValues` / `afterValues` ne capturent que les champs modifiés
 * (diff sparse), pas la ligne complète — facilite l'audit et le
 * rollback partiel.
 *
 * `status = 'cancelled'` permet de "défaire" une transformation sans
 * DELETE physique, pour conserver l'historique complet (undo/redo vague 2).
 */
@Entity({ name: 'entry_transformations' })
@Index('ix_entry_transformations_org_source', ['organizationId', 'sourceEntryId'])
@Index('ix_entry_transformations_org_type_status', ['organizationId', 'type', 'status'])
@Index('ix_entry_transformations_org_created_at', ['organizationId', 'createdAt'])
export class EntryTransformationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'source_entry_id', type: 'uuid' })
  sourceEntryId!: string;

  @ManyToOne(() => ImportStagingEntryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_entry_id' })
  sourceEntry!: ImportStagingEntryEntity;

  @Column({ type: 'text' })
  type!: TransformationType;

  @Column({ type: 'text', default: 'active' })
  status!: TransformationStatus;

  @Column({ name: 'before_values', type: 'jsonb', default: () => `'{}'::jsonb` })
  beforeValues!: TransformationDiff;

  @Column({ name: 'after_values', type: 'jsonb', default: () => `'{}'::jsonb` })
  afterValues!: TransformationDiff;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy!: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'cancelled_by_id', type: 'uuid', nullable: true })
  cancelledById!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cancelled_by_id' })
  cancelledBy!: UserEntity | null;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason!: string | null;
}
