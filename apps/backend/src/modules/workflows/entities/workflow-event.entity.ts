import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import type { WorkflowStatus } from '../types/workflow.types';
import { WorkflowInstanceEntity } from './workflow-instance.entity';

/**
 * `workflow_events` row — journal immuable des transitions d'état.
 *
 * Mirrors migration 0026.  Append-only : aucun UPDATE/DELETE.
 * `fromStatus` est NULL pour l'événement de démarrage synthétique.
 */
@Entity({ name: 'workflow_events' })
@Index('ix_workflow_events_instance_occurred', ['workflowInstanceId', 'occurredAt'])
export class WorkflowEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_instance_id', type: 'uuid' })
  workflowInstanceId!: string;

  @ManyToOne(() => WorkflowInstanceEntity, (i) => i.events, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_instance_id' })
  instance!: WorkflowInstanceEntity;

  @Column({ name: 'from_status', type: 'text', nullable: true })
  fromStatus!: WorkflowStatus | null;

  @Column({ name: 'to_status', type: 'text' })
  toStatus!: WorkflowStatus;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'now()' })
  occurredAt!: Date;
}
