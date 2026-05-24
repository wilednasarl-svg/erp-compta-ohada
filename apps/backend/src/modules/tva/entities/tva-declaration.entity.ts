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
import type { TvaDeclarationStatus } from '../types/tva.types';
import { TvaDeclarationLineEntity } from './tva-declaration-line.entity';

/**
 * `tva_declarations` row — voir migration 0047.
 *
 * Une déclaration TVA mensuelle pour une organisation. Périodicité mensuelle
 * en régime du Réel Normal d'Imposition (RNI) — la déclaration est posée
 * sur (year, month). Une seule déclaration `calculated` autorisée par
 * (org, year, month) ; les `cancelled` ne contrent pas la contrainte.
 *
 * Tous les totaux sont en `DECIMAL(15,2)` lus en `string`.
 */
@Entity({ name: 'tva_declarations' })
@Index('ix_tva_declarations_org_period', ['organizationId', 'periodYear', 'periodMonth'])
@Index('ix_tva_declarations_org_status', ['organizationId', 'status'])
export class TvaDeclarationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'period_year', type: 'integer' })
  periodYear!: number;

  @Column({ name: 'period_month', type: 'integer' })
  periodMonth!: number;

  @Column({ type: 'text', default: 'draft' })
  status!: TvaDeclarationStatus;

  // Totaux agrégés issus du compute. Format DECIMAL(15,2) → string.
  @Column({ name: 'tva_collectee_total', type: 'numeric', precision: 15, scale: 2, default: 0 })
  tvaCollecteeTotal!: string;

  @Column({ name: 'tva_deductible_bs_total', type: 'numeric', precision: 15, scale: 2, default: 0 })
  tvaDeductibleBsTotal!: string;

  @Column({
    name: 'tva_deductible_immo_total',
    type: 'numeric',
    precision: 15,
    scale: 2,
    default: 0,
  })
  tvaDeductibleImmoTotal!: string;

  // = collectée - (déductible_bs + déductible_immo) si positif, 0 sinon.
  @Column({ name: 'tva_a_decaisser', type: 'numeric', precision: 15, scale: 2, default: 0 })
  tvaADecaisser!: string;

  // = abs(collectée - déductible_total) si négatif, 0 sinon.
  @Column({ name: 'credit_tva_reportable', type: 'numeric', precision: 15, scale: 2, default: 0 })
  creditTvaReportable!: string;

  @Column({ name: 'computed_at', type: 'timestamptz', nullable: true })
  computedAt!: Date | null;

  @Column({ name: 'computed_by_id', type: 'uuid', nullable: true })
  computedById!: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'cancelled_by_id', type: 'uuid', nullable: true })
  cancelledById!: string | null;

  @Column({ name: 'cancelled_reason', type: 'text', nullable: true })
  cancelledReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => TvaDeclarationLineEntity, (line) => line.declaration, { cascade: ['insert'] })
  lines!: TvaDeclarationLineEntity[];
}
