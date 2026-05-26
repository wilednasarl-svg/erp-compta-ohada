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
import type { ProvisionStatus, ProvisionType } from '../types/provision.types';

/**
 * `provisions` row — voir migration 0094.
 *
 * Une ligne par risque/charge provisionne. `currentAmount` represente
 * le solde restant apres reprises/utilisations; il doit rester >= 0
 * (CHECK applique cote DB). Quand il tombe a 0, le service bascule
 * automatiquement `status='closed'`.
 *
 * Les montants en NUMERIC(15,2) sont exposes comme `string` cote TypeORM
 * pour preserver la precision decimale (cf. pattern AssetEntity).
 */
@Entity({ name: 'provisions' })
@Index('ix_provisions_org_status', ['organizationId', 'status'])
@Index('ix_provisions_org_type', ['organizationId', 'type'])
export class ProvisionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ type: 'text' })
  type!: ProvisionType;

  @Column({ name: 'account_code', type: 'varchar', length: 10 })
  accountCode!: string;

  @Column({ type: 'text' })
  label!: string;

  @Column({ name: 'initial_amount', type: 'numeric', precision: 15, scale: 2 })
  initialAmount!: string;

  @Column({ name: 'current_amount', type: 'numeric', precision: 15, scale: 2 })
  currentAmount!: string;

  @Column({ type: 'text', default: 'active' })
  status!: ProvisionStatus;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'closed_by_id', type: 'uuid', nullable: true })
  closedById!: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
