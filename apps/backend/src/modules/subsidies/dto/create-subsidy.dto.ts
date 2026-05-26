import type { SubsidyReleaseMethod } from '../types/subsidy.types';

/**
 * W4.4 — Payload de création d'une subvention d'investissement.
 *
 * La création pose immédiatement l'écriture d'octroi via EntriesService :
 *   D `grantDebitAccount` (par défaut 4494 — créance bailleur, ou 521 si
 *      encaissement immédiat) / C 1411 (subvention d'investissement reçue).
 *
 * Si `assetId` est fourni et `releaseMethod === 'on_depreciation'`, le
 * service utilisera `assetAcquisitionCost` × dotation pour calculer la
 * quote-part de subvention à reprendre à chaque dotation postée.
 */
export class CreateSubsidyDto {
  /** Asset financé par la subvention (null = subvention non liée). */
  readonly assetId?: string | null;

  /** Nom du bailleur / organisme accordant la subvention. */
  readonly grantorName!: string;

  /** Date d'octroi (ISO YYYY-MM-DD). */
  readonly grantDate!: string;

  /** Montant total octroyé (NUMERIC 15,2 — chaîne "0.00", > 0). */
  readonly totalAmount!: string;

  /** Méthode de reprise au résultat. */
  readonly releaseMethod!: SubsidyReleaseMethod;

  /** Compte débité à l'octroi (4494 par défaut, 521 si encaissement direct). */
  readonly grantDebitAccount?: string;

  /** Code du journal cible (défaut OD si non fourni). */
  readonly journalCode?: string;

  /** Note libre. */
  readonly note?: string;
}
