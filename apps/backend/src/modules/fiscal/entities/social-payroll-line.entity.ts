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

/**
 * `social_payroll_lines` row — voir migration 0116.
 *
 * Salaire brut d'un salarié sur un mois. Sert de base au calcul EXACT des
 * charges sociales par tête (plafond CNPS et barème ITS appliqués par
 * salarié avant agrégation). Montant en `string` (NUMERIC).
 */
@Entity({ name: 'social_payroll_lines' })
@Index(
  'uq_social_payroll_lines_natural_key',
  ['organizationId', 'periodYear', 'periodMonth', 'employeeRef'],
  { unique: true },
)
@Index('ix_social_payroll_lines_org_period', ['organizationId', 'periodYear', 'periodMonth'])
export class SocialPayrollLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'period_year', type: 'int' })
  periodYear!: number;

  @Column({ name: 'period_month', type: 'int' })
  periodMonth!: number;

  @Column({ name: 'employee_ref', type: 'text' })
  employeeRef!: string;

  @Column({ name: 'gross_salary', type: 'numeric', precision: 18, scale: 2, default: 0 })
  grossSalary!: string;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
