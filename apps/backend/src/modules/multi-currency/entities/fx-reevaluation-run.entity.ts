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
 * Statut du cycle de vie d'une run de réévaluation FX.
 *
 *   - `pending`  : créée mais pas encore exécutée (réservé pour un
 *     futur déclenchement asynchrone — Wave 1 passe directement à
 *     `executed` dans la même transaction).
 *   - `executed` : écriture d'écart générée et persistée à `closingDate`.
 *   - `reversed` : contre-passation au `reversalDate` appliquée.
 *   - `failed`   : erreur durant l'exécution, `errorMessage` rempli.
 */
export type FxReevaluationStatus = 'pending' | 'executed' | 'reversed' | 'failed';

/**
 * Détail d'audit, persisté en JSONB sur chaque run, pour chaque compte
 * réévalué. Permet à un commissaire aux comptes de re-vérifier ligne
 * à ligne le calcul de l'écart de conversion (article 54 AU).
 */
export interface FxReevaluationAccountDetail {
  readonly accountCode: string;
  readonly originalCurrency: string;
  readonly originalAmountCurrency: string;
  readonly originalRate: string;
  readonly closingRate: string;
  readonly currentAmountXof: string;
  readonly recalculatedAmount: string;
  readonly ecart: string;
  readonly contraAccountCode: '478' | '479';
}

/**
 * `fx_reevaluation_runs` — voir migration 0095.
 *
 * Une run = une exécution de la réévaluation FX à la clôture d'un
 * exercice donné pour une organisation. L'unicité `(org, closingDate)`
 * empêche deux runs concurrentes sur le même bilan.
 */
@Entity({ name: 'fx_reevaluation_runs' })
@Index('uq_fx_reevaluation_runs_org_closing', ['organizationId', 'closingDate'], { unique: true })
@Index('ix_fx_reevaluation_runs_org_status', ['organizationId', 'status'])
@Index('ix_fx_reevaluation_runs_closing_date', ['closingDate'])
export class FxReevaluationRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'closing_date', type: 'date' })
  closingDate!: string;

  @Column({ name: 'reversal_date', type: 'date' })
  reversalDate!: string;

  @Column({ type: 'text', default: 'pending' })
  status!: FxReevaluationStatus;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt!: Date | null;

  @Column({ name: 'executed_by_id', type: 'uuid', nullable: true })
  executedById!: string | null;

  @Column({ name: 'reversed_at', type: 'timestamptz', nullable: true })
  reversedAt!: Date | null;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ name: 'reversal_journal_entry_id', type: 'uuid', nullable: true })
  reversalJournalEntryId!: string | null;

  // JSONB — détail par compte. Lecture only depuis le service ; jamais
  // mutée en place pour préserver l'immutabilité.
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  metadata!: ReadonlyArray<FxReevaluationAccountDetail>;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
