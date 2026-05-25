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
 * `currencies` row — voir migration 0063.
 *
 * Catalogue par organisation. Une org démarre avec un set seedé (XOF,
 * EUR, USD, GBP, CNY, CHF, CAD, MAD, NGN — cf. `DEFAULT_CURRENCIES`)
 * et peut en ajouter d'autres ISO 4217. La désactivation (`isActive`)
 * empêche de saisir de nouveaux taux mais préserve l'historique.
 */
@Entity({ name: 'currencies' })
@Index('uq_currencies_org_code', ['organizationId', 'code'], { unique: true })
@Index('ix_currencies_org_active', ['organizationId', 'isActive'])
export class CurrencyEntity {
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

  @Column({ name: 'decimal_places', type: 'smallint', default: 2 })
  decimalPlaces!: 0 | 2 | 3;

  @Column({ type: 'text', nullable: true })
  symbol!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
