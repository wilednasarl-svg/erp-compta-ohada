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
import type { ProvisionMovementKind } from '../types/provision.types';
import { ProvisionEntity } from './provision.entity';

/**
 * `provision_movements` row — voir migration 0094.
 *
 * Journal append-only des mouvements appliques a une provision :
 *   - `dotation`     : creation / augmentation → ecriture comptable
 *                      D 691x|697x / C 19x
 *   - `reprise`      : diminution sans paiement → ecriture
 *                      D 19x / C 791x|797x
 *   - `utilization`  : absorption d'un cout reel par la provision
 *                      (ex: paiement du litige) → pas d'ecriture cote
 *                      provisions, le paiement est pose par un autre
 *                      module. `journal_entry_id` reste NULL.
 *
 * `organization_id` est denormalise pour permettre une RLS / un index
 * tenant-scope sans avoir a join via `provisions`.
 */
@Entity({ name: 'provision_movements' })
@Index('ix_provision_movements_provision', ['provisionId', 'effectiveDate', 'createdAt'])
@Index('ix_provision_movements_org_kind', ['organizationId', 'kind', 'effectiveDate'])
export class ProvisionMovementEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'provision_id', type: 'uuid' })
  provisionId!: string;

  @ManyToOne(() => ProvisionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provision_id' })
  provision!: ProvisionEntity;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ type: 'text' })
  kind!: ProvisionMovementKind;

  @Column({ type: 'numeric', precision: 15, scale: 2 })
  amount!: string;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ name: 'effective_date', type: 'date' })
  effectiveDate!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
