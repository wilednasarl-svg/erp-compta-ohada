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
import type { AnomalySource, AnomalyType } from '../types/ai.types';

@Entity({ name: 'ai_anomalies' })
@Index('ix_ai_anomalies_org_period', ['organizationId', 'periodId'])
@Index('ix_ai_anomalies_org_score', ['organizationId', 'riskScore'])
@Index('ix_ai_anomalies_org_type', ['organizationId', 'anomalyType'])
export class AiAnomalyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'period_id', type: 'uuid', nullable: true })
  periodId!: string | null;

  @Column({ name: 'entry_id', type: 'uuid', nullable: true })
  entryId!: string | null;

  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId!: string | null;

  @Column({ name: 'anomaly_type', type: 'text' })
  anomalyType!: AnomalyType;

  @Column({ name: 'risk_score', type: 'integer' })
  riskScore!: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  reasons!: string[];

  @Column({ name: 'detected_by', type: 'text', default: 'heuristic_v1' })
  detectedBy!: AnomalySource;

  @Column({ name: 'detected_at', type: 'timestamptz' })
  detectedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
