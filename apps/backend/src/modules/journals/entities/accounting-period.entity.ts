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

import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { AccountingPeriodKind, AccountingPeriodStatus } from '../types/journal.types';

/**
 * `accounting_periods` row — voir migration 0036.
 *
 * Hiérarchie matérialisée par `parent_id` :
 *   - une ANNUAL est racine
 *   - QUARTERLY / MONTHLY pointent vers une ANNUAL parente
 */
@Entity({ name: 'accounting_periods' })
@Index('ix_accounting_periods_org_status', ['organizationId', 'status'])
@Index('ix_accounting_periods_org_dates', ['organizationId', 'startDate', 'endDate'])
export class AccountingPeriodEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => AccountingPeriodEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent?: AccountingPeriodEntity | null;

  @OneToMany(() => AccountingPeriodEntity, (p) => p.parent)
  children?: AccountingPeriodEntity[];

  @Column({ type: 'text' })
  kind!: AccountingPeriodKind;

  @Column({ type: 'text' })
  label!: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  @Column({ type: 'text', default: 'open' })
  status!: AccountingPeriodStatus;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'closed_by', type: 'uuid', nullable: true })
  closedBy!: string | null;

  @Column({ name: 'reopened_reason', type: 'text', nullable: true })
  reopenedReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
