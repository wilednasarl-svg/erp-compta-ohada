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
import type { PledgeStatus, PledgeType } from '../types/pledged-asset.types';

/**
 * `pledged_assets` row — voir migration 0108.
 *
 * Registre des sûretés réelles données par l'entité sur ses actifs en
 * garantie d'une dette financière. Sert d'agrégat racine pour les
 * notes N1 (dettes garanties — vue passif) et N16Bbis (actifs nantis
 * — vue actif).
 *
 * Doctrine SYSCOHADA Tome 3 p. 35 :
 *   « Emprunts et dettes des établissements de crédit : 100 000 000 |
 *     Hypothèque sur ensemble immobilier sis à Kalala (TF 456N23)
 *     garantissant l'emprunt London City le 13/08/N »
 *
 * Conventions :
 *   - `brutAmount` NUMERIC(15,2) exposé en `string` (préservation
 *     décimale, conforme au reste du backend).
 *   - `status` : 'active' par défaut ; bascule 'released' à la
 *     main-levée (avec `releasedAt`) ; 'cancelled' pour annulation
 *     administrative.
 *   - Pas de FK vers une table `liabilities` — le compte est référencé
 *     par son code SYSCOHADA (16x/17x/18x/4x partiel) pour rester
 *     découplé du plan comptable propre à chaque tenant.
 */
@Entity({ name: 'pledged_assets' })
@Index('ix_pledged_assets_org_status', ['organizationId', 'status'])
@Index('ix_pledged_assets_org_type', ['organizationId', 'pledgeType'])
@Index('ix_pledged_assets_start_date', ['startDate'])
export class PledgedAssetEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  /** Compte SYSCOHADA de la dette garantie (16x/17x/18x ou 4x partiel). */
  @Column({ name: 'liability_account_code', type: 'varchar', length: 16 })
  liabilityAccountCode!: string;

  /** Libellé humain de la dette (ex. "Emprunt London City 13/08/N"). */
  @Column({ name: 'liability_label', type: 'text' })
  liabilityLabel!: string;

  @Column({ name: 'brut_amount', type: 'numeric', precision: 15, scale: 2 })
  brutAmount!: string;

  @Column({ name: 'pledge_type', type: 'text' })
  pledgeType!: PledgeType;

  /** Référence de l'actif donné en garantie (ex. "Titre foncier n° 456N23"). */
  @Column({ name: 'asset_reference', type: 'text' })
  assetReference!: string;

  /** Localisation de l'actif (ex. "Kalala"). Nullable. */
  @Column({ name: 'asset_location', type: 'text', nullable: true })
  assetLocation!: string | null;

  /** Nom du créancier bénéficiaire de la sûreté (ex. "London City"). */
  @Column({ name: 'creditor_name', type: 'text' })
  creditorName!: string;

  /** Date de constitution de la sûreté. */
  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  /** Date d'extinction prévue / contractuelle. Nullable. */
  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate!: string | null;

  @Column({ type: 'text', default: 'active' })
  status!: PledgeStatus;

  /**
   * Commentaire libre repris dans la note annexe (texte de doctrine
   * Tome 3 : « commentaire obligatoire »).
   */
  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
