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

import { UserEntity } from '../../auth/entities/user.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { RuleAction, RuleCondition } from '../types/rule.types';

@Entity({ name: 'rules' })
@Index('ix_rules_org_active', ['organizationId', 'isActive'])
@Index('ix_rules_org_priority', ['organizationId', 'priority'])
@Index('ix_rules_org_created_at', ['organizationId', 'createdAt'])
export class RuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  /** Ordre d'évaluation — valeur basse = évaluée en premier. */
  @Column({ type: 'int', default: 100 })
  priority!: number;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  conditions!: RuleCondition[];

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  actions!: RuleAction[];

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy!: UserEntity;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'updated_by_id' })
  updatedBy!: UserEntity | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
