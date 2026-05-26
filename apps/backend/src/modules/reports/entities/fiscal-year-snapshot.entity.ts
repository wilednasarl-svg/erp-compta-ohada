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

/**
 * Types de snapshots SYSCOHADA fixables — alignés sur les 4 états
 * financiers obligatoires de l'Acte Uniforme (article 8 AUDCIF).
 */
export type FiscalYearSnapshotType = 'BILAN' | 'PROFIT_LOSS' | 'SIG' | 'TFT';

export const FISCAL_YEAR_SNAPSHOT_TYPES: ReadonlyArray<FiscalYearSnapshotType> = [
  'BILAN',
  'PROFIT_LOSS',
  'SIG',
  'TFT',
];

/**
 * `fiscal_year_snapshots` — voir migration 0101.
 *
 * Fige les chiffres officiels d'un exercice clôturé pour servir de base
 * de comparaison N-1 dans la liasse SYSCOHADA (Bilan colonne N-1, CR
 * colonne N-1, etc.). Append-only : re-fixer ⇒ marquer la précédente
 * `superseded_at` et insérer une nouvelle ligne.
 *
 * Unicité d'index PARTIEL `uq_fiscal_year_snapshots_active` (côté DB) :
 * un seul snapshot ACTIF par (org, exercise, type) — la contrainte
 * autorise l'historique.
 */
@Entity({ name: 'fiscal_year_snapshots' })
@Index('ix_fiscal_year_snapshots_history', [
  'organizationId',
  'exerciseId',
  'snapshotType',
  'takenAt',
])
export class FiscalYearSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'exercise_id', type: 'uuid' })
  exerciseId!: string;

  @Column({ name: 'snapshot_type', type: 'text' })
  snapshotType!: FiscalYearSnapshotType;

  /**
   * Payload JSON brut du rapport au moment de la fige. Structure libre
   * dépendante de `snapshotType` : `BalanceSheetReport` / `ProfitLossReport`
   * / `SigReport` / `TftReport`. Le consommateur cast.
   */
  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'taken_at', type: 'timestamptz' })
  takenAt!: Date;

  @Column({ name: 'taken_by_id', type: 'uuid', nullable: true })
  takenById!: string | null;

  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true })
  supersededAt!: Date | null;
}
