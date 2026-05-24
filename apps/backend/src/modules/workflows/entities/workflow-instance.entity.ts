import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { WorkflowStatus, WorkflowTargetType } from '../types/workflow.types';
import { WorkflowDefinitionEntity } from './workflow-definition.entity';
import { WorkflowEventEntity } from './workflow-event.entity';

/**
 * `workflow_instances` row — instance d'un workflow appliqué à un objet.
 *
 * Mirrors migration 0025.  `currentStatus` est la source de vérité pour
 * l'état courant ; `events` est le journal immuable des transitions.
 */
@Entity({ name: 'workflow_instances' })
@Index('ix_workflow_instances_org_status', ['organizationId', 'currentStatus'])
@Index('ix_workflow_instances_org_target', ['organizationId', 'targetType', 'targetId'])
export class WorkflowInstanceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_definition_id', type: 'uuid' })
  workflowDefinitionId!: string;

  @ManyToOne(() => WorkflowDefinitionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'workflow_definition_id' })
  definition!: WorkflowDefinitionEntity;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'target_type', type: 'text' })
  targetType!: WorkflowTargetType;

  @Column({ name: 'target_id', type: 'uuid' })
  targetId!: string;

  @Column({ name: 'current_status', type: 'text', default: 'draft' })
  currentStatus!: WorkflowStatus;

  @Column({ name: 'started_by', type: 'uuid', nullable: true })
  startedBy!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'now()' })
  startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => WorkflowEventEntity, (e) => e.instance, { cascade: ['insert'] })
  events!: WorkflowEventEntity[];
}
