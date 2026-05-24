import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { OrganizationAccountEntity } from '../../accounting-plan/entities/organization-account.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { UserEntity } from '../../auth/entities/user.entity';

export type LetteringStatus = 'open' | 'complete' | 'broken';

/**
 * `partner_letterings` row — voir migration 0043.
 *
 * Un lettrage relie N lignes d'écriture sur le MÊME compte tiers (4xx)
 * dont la somme des débits égale la somme des crédits. Les lignes
 * pointent vers le lettrage via `journal_entry_lines.lettering_id`.
 *
 * Statuts :
 *   - `open`     : créé, peut accueillir des lignes additionnelles
 *                  (extension à venir wave 2.1) ;
 *   - `complete` : équilibré, soldé (cas le plus fréquent à la création) ;
 *   - `broken`   : délettré par l'utilisateur ; les lignes ont été
 *                  détachées (lettering_id = NULL) et le record reste
 *                  pour audit.
 *
 * `lettering_code` est un identifiant court humainement lisible
 * (A0001, A0002…) unique par organisation.
 */
@Entity({ name: 'partner_letterings' })
@Index('ix_partner_letterings_org_account_status', ['organizationId', 'partnerAccountId', 'status'])
export class PartnerLetteringEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'lettering_code', type: 'varchar', length: 8 })
  letteringCode!: string;

  @Column({ name: 'partner_account_id', type: 'uuid' })
  partnerAccountId!: string;

  @ManyToOne(() => OrganizationAccountEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'partner_account_id' })
  partnerAccount!: OrganizationAccountEntity;

  @Column({ name: 'partner_label', type: 'text' })
  partnerLabel!: string;

  @Column({ name: 'total_amount', type: 'numeric', precision: 15, scale: 2 })
  totalAmount!: string;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status!: LetteringStatus;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy!: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'broken_at', type: 'timestamptz', nullable: true })
  brokenAt!: Date | null;

  @Column({ name: 'broken_reason', type: 'text', nullable: true })
  brokenReason!: string | null;

  @Column({ name: 'broken_by_id', type: 'uuid', nullable: true })
  brokenById!: string | null;
}
