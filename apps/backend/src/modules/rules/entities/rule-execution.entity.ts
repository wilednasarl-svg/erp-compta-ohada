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
import type { RuleMatch, RuleScope } from '../types/rule.types';
import { RuleEntity } from './rule.entity';

export type RuleExecutionMode = 'simulation' | 'apply';

@Entity({ name: 'rule_executions' })
@Index('ix_rule_executions_org_rule_created_at', ['organizationId', 'ruleId', 'createdAt'])
@Index('ix_rule_executions_org_created_at', ['organizationId', 'createdAt'])
export class RuleExecutionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'rule_id', type: 'uuid' })
  ruleId!: string;

  @ManyToOne(() => RuleEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rule_id' })
  rule!: RuleEntity;

  @Column({ type: 'text' })
  mode!: RuleExecutionMode;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  scope!: RuleScope;

  @Column({ name: 'matched_count', type: 'int', default: 0 })
  matchedCount!: number;

  @Column({ name: 'applied_count', type: 'int', default: 0 })
  appliedCount!: number;

  /** Array of transformation IDs created during apply mode. */
  @Column({ name: 'transformation_ids', type: 'jsonb', default: () => `'[]'::jsonb` })
  transformationIds!: string[];

  /** Snapshot of matched entries and their resolved actions. */
  @Column({ name: 'matches_snapshot', type: 'jsonb', default: () => `'[]'::jsonb` })
  matchesSnapshot!: RuleMatch[];

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'executed_by_id', type: 'uuid' })
  executedById!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'executed_by_id' })
  executedBy!: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
