/**
 * E2 — Engagements actuariels retraite & avantages au personnel
 * (Tome 3 N16B + Tome 2 chap. 21).
 *
 * Types partagés entre l'entité TypeORM, le service applicatif et le
 * handler N16B des Notes annexes.
 */

/** Catégorie d'engagement actuariel. */
export type ActuarialCommitmentType =
  | 'retraite_ifc'
  | 'medaille_du_travail'
  | 'preavis_legal'
  | 'autre';

/** Statut d'une évaluation actuarielle. */
export type ActuarialCommitmentStatus = 'active' | 'expired' | 'cancelled';

/** Compte SYSCOHADA pour la partie déjà provisionnée. */
export const ACTUARIAL_PROVISION_ACCOUNT = '196';

/**
 * Snapshot consommé par le handler N16B (decoupling : on n'importe pas
 * l'entité TypeORM dans le moteur de Notes annexes pour éviter le cycle
 * DI et conserver une vue stable du contrat de lecture).
 */
export interface ActuarialCommitmentSnapshot {
  readonly id: string;
  readonly commitmentType: ActuarialCommitmentType;
  readonly label: string;
  readonly valuationDate: string;
  /** Montant total de la DAP (NUMERIC 15,2 en string). */
  readonly obligationAmount: string;
  /** Partie déjà comptabilisée en compte 196. */
  readonly provisionedAmount: string;
  /** `obligation - provisioned`, calculé service-side. */
  readonly offBalanceSheetAmount: string;
  readonly discountRate: string;
  readonly mortalityTable: string;
  readonly actuaryName: string | null;
  readonly status: ActuarialCommitmentStatus;
}
