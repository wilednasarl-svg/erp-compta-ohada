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
import type { RegularizationType } from '../types/regularization.types';
import { RegularizationBatchEntity } from './regularization-batch.entity';

/**
 * `regularization_entries` row — voir migration 0096.
 *
 * Une entrée = une régularisation individuelle au sein d'un batch.
 * Le `type` détermine la sémantique D/C (voir
 * `REGULARIZATION_LINE_MAPPING` dans `regularization.types.ts`).
 *
 *   - `expenseRevenueAccount` : code 6xx/7xx (ou 4455/4435 pour les
 *     entrées de TVA miroir cap_tva/par_tva).
 *   - `regularizationAccount` : code 476/477/408/4181/4098/4287/etc.
 *   - `amount`   : montant HT (ou montant pur TVA pour cap_tva/par_tva).
 *   - `tvaAmount`: TVA associée pour cap_charge/par_produit si l'utilisateur
 *                  souhaite expliciter dans la même entrée le montant TVA
 *                  miroir (informationnel ; la TVA elle-même DOIT être
 *                  saisie en entrée séparée `cap_tva`/`par_tva` pour
 *                  apparaître dans l'écriture).
 *
 * `organizationId` est dénormalisé pour permettre les requêtes de
 * scoping sans jointure ; il est garanti cohérent avec le batch parent
 * via le service (et un trigger pourrait l'enforcer si nécessaire).
 *
 * CASCADE sur le batch parent : supprimer un batch draft supprime ses
 * entrées. Un batch executed/reversed est non supprimable côté service.
 */
@Entity({ name: 'regularization_entries' })
@Index('ix_regularization_entries_batch', ['batchId'])
@Index('ix_regularization_entries_org_type', ['organizationId', 'type'])
export class RegularizationEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'batch_id', type: 'uuid' })
  batchId!: string;

  @ManyToOne(() => RegularizationBatchEntity, (batch) => batch.entries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'batch_id' })
  batch!: RegularizationBatchEntity;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ type: 'text' })
  type!: RegularizationType;

  @Column({ name: 'expense_revenue_account', type: 'text' })
  expenseRevenueAccount!: string;

  @Column({ name: 'regularization_account', type: 'text' })
  regularizationAccount!: string;

  @Column({ type: 'numeric', precision: 15, scale: 2 })
  amount!: string;

  @Column({ name: 'tva_amount', type: 'numeric', precision: 15, scale: 2, default: 0 })
  tvaAmount!: string;

  @Column({ type: 'text' })
  label!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
