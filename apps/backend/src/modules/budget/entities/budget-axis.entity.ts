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

import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { BudgetAxisType } from '../types/budget.types';

/**
 * `budget_axes` row — voir migration 0111.
 *
 * Référentiel des axes analytiques d'une organisation. Un axe = un type
 * (centre de coût, projet, agence, produit, zone) + un code unique dans
 * l'org. `parentId` (auto-référence) porte la hiérarchie de consolidation
 * (ex. agence `ABJ-PLAT` → région `ABIDJAN`).
 */
@Entity({ name: 'budget_axes' })
@Index('uq_budget_axes_org_type_code', ['organizationId', 'axisType', 'code'], { unique: true })
@Index('ix_budget_axes_org_type_active', ['organizationId', 'axisType', 'isActive'])
export class BudgetAxisEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'axis_type', type: 'text' })
  axisType!: BudgetAxisType;

  @Column({ type: 'text' })
  code!: string;

  @Column({ type: 'text' })
  label!: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => BudgetAxisEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent!: BudgetAxisEntity | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
