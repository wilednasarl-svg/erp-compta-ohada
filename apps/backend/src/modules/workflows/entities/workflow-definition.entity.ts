import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { WorkflowTargetType } from '../types/workflow.types';
import type { WorkflowInstanceEntity } from './workflow-instance.entity';

/**
 * `workflow_definitions` row — catalogue des types de workflows.
 *
 * Mirrors migration 0024.  En wave 1, une seule définition active existe
 * (`import_session`).  L'entité est en lecture seule côté API.
 */
@Entity({ name: 'workflow_definitions' })
@Index('ix_workflow_definitions_target_type', ['targetType'])
export class WorkflowDefinitionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'target_type', type: 'text' })
  targetType!: WorkflowTargetType;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany('WorkflowInstanceEntity', 'definition')
  instances?: WorkflowInstanceEntity[];
}
