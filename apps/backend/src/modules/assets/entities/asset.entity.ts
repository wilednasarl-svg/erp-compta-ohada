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
import type { AssetStatus, DepreciationMethod } from '../types/asset.types';

/**
 * `assets` row — voir migration 0046.
 *
 * Registre des immobilisations corporelles et incorporelles d'une
 * organisation. Un asset porte les trois comptes SYSCOHADA qu'il agite :
 *   - `asset_account_id`        — compte 21x/22x/23x/24x (immo brute)
 *   - `depreciation_account_id` — compte 28x (amortissements cumulés)
 *   - `expense_account_id`      — compte 681x (dotation aux amortissements)
 *
 * Les montants en `NUMERIC(15,2)` sont exposés comme `string` côté
 * TypeORM pour préserver la précision décimale.
 */
@Entity({ name: 'assets' })
@Index('uq_assets_org_code', ['organizationId', 'code'], { unique: true })
@Index('ix_assets_org_status', ['organizationId', 'status'])
@Index('ix_assets_org_asset_account', ['organizationId', 'assetAccountId'])
export class AssetEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ type: 'text' })
  code!: string;

  @Column({ type: 'text' })
  label!: string;

  @Column({ name: 'acquisition_date', type: 'date' })
  acquisitionDate!: string;

  @Column({ name: 'put_in_service_date', type: 'date' })
  putInServiceDate!: string;

  @Column({ name: 'acquisition_cost', type: 'numeric', precision: 15, scale: 2 })
  acquisitionCost!: string;

  @Column({ name: 'residual_value', type: 'numeric', precision: 15, scale: 2, default: 0 })
  residualValue!: string;

  @Column({ name: 'depreciation_method', type: 'text' })
  depreciationMethod!: DepreciationMethod;

  @Column({ name: 'duration_months', type: 'integer' })
  durationMonths!: number;

  @Column({
    name: 'declining_rate',
    type: 'numeric',
    precision: 6,
    scale: 4,
    nullable: true,
  })
  decliningRate!: string | null;

  @Column({ name: 'asset_account_id', type: 'uuid' })
  assetAccountId!: string;

  @Column({ name: 'depreciation_account_id', type: 'uuid' })
  depreciationAccountId!: string;

  @Column({ name: 'expense_account_id', type: 'uuid' })
  expenseAccountId!: string;

  @Column({ type: 'text', default: 'active' })
  status!: AssetStatus;

  @Column({ name: 'disposal_date', type: 'date', nullable: true })
  disposalDate!: string | null;

  @Column({
    name: 'disposal_value',
    type: 'numeric',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  disposalValue!: string | null;

  // ─── W4.3 — UOP (units of production) ───────────────────────────
  @Column({
    name: 'total_units',
    type: 'numeric',
    precision: 15,
    scale: 4,
    nullable: true,
  })
  totalUnits!: string | null;

  @Column({ name: 'units_per_year', type: 'jsonb', nullable: true })
  unitsPerYear!: number[] | null;

  // ─── W4.3 — Amortissements dérogatoires ─────────────────────────
  @Column({ name: 'derogatory_enabled', type: 'boolean', default: false })
  derogatoryEnabled!: boolean;

  @Column({ name: 'derogatory_fiscal_method', type: 'text', nullable: true })
  derogatoryFiscalMethod!: DepreciationMethod | null;

  @Column({ name: 'derogatory_fiscal_duration', type: 'integer', nullable: true })
  derogatoryFiscalDuration!: number | null;

  @Column({
    name: 'derogatory_fiscal_declining_rate',
    type: 'numeric',
    precision: 6,
    scale: 4,
    nullable: true,
  })
  derogatoryFiscalDecliningRate!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
