import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { ScoreBreakdown, ScoreCalculator, ScoreGrade } from '../types/accounting-score.types';

/**
 * `accounting_scores` row — voir migration 0078.
 *
 * Append-only : chaque recalcul = 1 nouvelle ligne. Le score "courant"
 * est obtenu via `ORDER BY calculated_at DESC LIMIT 1` (cf. repo).
 */
@Entity({ name: 'accounting_scores' })
@Index('ix_accounting_scores_org_exercise_calc', ['organizationId', 'exerciseId', 'calculatedAt'])
@Index('ix_accounting_scores_org_calc', ['organizationId', 'calculatedAt'])
export class AccountingScoreEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'exercise_id', type: 'uuid' })
  exerciseId!: string;

  @Column({ type: 'integer' })
  score!: number;

  @Column({ type: 'text' })
  grade!: ScoreGrade;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  breakdown!: ScoreBreakdown;

  @CreateDateColumn({ name: 'calculated_at', type: 'timestamptz' })
  calculatedAt!: Date;

  @Column({ name: 'calculated_by', type: 'text', default: 'heuristic_v1' })
  calculatedBy!: ScoreCalculator;
}
