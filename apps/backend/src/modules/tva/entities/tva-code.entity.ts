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
import type { TvaCodeKind, TvaCodeType } from '../types/tva.types';

/**
 * `tva_codes` row — voir migration 0046.
 *
 * Catalogue de codes TVA par organisation. 4 codes standards Côte d'Ivoire
 * sont seedés à la création d'une org via `TvaCodesService.seedDefaultCodes`.
 * L'org peut ajouter des codes additionnels (régimes spéciaux, ZES, etc.).
 *
 * `rate` est stocké en `DECIMAL(5,2)` (0.00 → 99.99) et exposé en `string`
 * pour préserver la précision.
 */
@Entity({ name: 'tva_codes' })
@Index('ix_tva_codes_org_active', ['organizationId', 'isActive'])
@Index('uq_tva_codes_org_code', ['organizationId', 'code'], { unique: true })
export class TvaCodeEntity {
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

  // DECIMAL(5,2) — read/write en string pour préserver la précision.
  @Column({ type: 'numeric', precision: 5, scale: 2 })
  rate!: string;

  @Column({ type: 'text' })
  type!: TvaCodeType;

  @Column({ type: 'text' })
  kind!: TvaCodeKind;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
