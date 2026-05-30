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
 * `fiscal_tax_brackets` row — voir migration 0115.
 *
 * Une tranche d'un barème progressif (ITS) : [fromAmount, toAmount) × rate.
 * `toAmount` nul = tranche supérieure ouverte. Montants/taux en `string`.
 */
@Entity({ name: 'fiscal_tax_brackets' })
@Index(
  'uq_fiscal_tax_brackets_order',
  ['organizationId', 'taxCode', 'effectiveFrom', 'bracketOrder'],
  {
    unique: true,
  },
)
@Index('ix_fiscal_tax_brackets_org_code_from', ['organizationId', 'taxCode', 'effectiveFrom'])
export class FiscalTaxBracketEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'tax_code', type: 'text' })
  taxCode!: string;

  @Column({ name: 'effective_from', type: 'date' })
  effectiveFrom!: string;

  @Column({ name: 'bracket_order', type: 'int' })
  bracketOrder!: number;

  @Column({ name: 'from_amount', type: 'numeric', precision: 18, scale: 2 })
  fromAmount!: string;

  @Column({ name: 'to_amount', type: 'numeric', precision: 18, scale: 2, nullable: true })
  toAmount!: string | null;

  @Column({ type: 'numeric', precision: 8, scale: 4 })
  rate!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
