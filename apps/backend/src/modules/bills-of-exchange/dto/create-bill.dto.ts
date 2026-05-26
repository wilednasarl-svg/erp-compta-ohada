import type { BillKind } from '../types/bill.types';

/**
 * W4.6 — Payload d'emission d'un effet de commerce.
 *
 * `kind=receivable` : effet a recevoir sur un client. L'ecriture posee
 *   sera D 412 (effets a recevoir) / C `partnerAccountCode` (411x du
 *   client). `currentLocationAccount` part a 412.
 *
 * `kind=payable` : effet a payer a un fournisseur. L'ecriture posee
 *   sera D `partnerAccountCode` (401x du fournisseur) / C 402.
 *   `currentLocationAccount` part a 402.
 */
export class CreateBillDto {
  readonly kind!: BillKind;
  /** Compte de la creance/dette d'origine (411x client ou 401x fournisseur). */
  readonly partnerAccountCode!: string;
  readonly partnerName!: string;
  /** Numero/reference de l'effet. */
  readonly billNumber!: string;
  /** Date d'emission de l'effet (ISO YYYY-MM-DD). */
  readonly issueDate!: string;
  /** Date d'echeance (ISO YYYY-MM-DD). */
  readonly dueDate!: string;
  /** Montant nominal en monnaie locale (> 0). */
  readonly nominalAmount!: string;
  /** Code du journal cible (defaut OD si non fourni). */
  readonly journalCode?: string;
  /** Note libre attachee a l'effet et a l'evenement d'emission. */
  readonly note?: string;
}
