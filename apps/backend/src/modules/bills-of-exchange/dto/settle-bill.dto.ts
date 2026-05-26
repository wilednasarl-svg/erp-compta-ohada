/**
 * W4.6 — Payload de paiement (`settle`) ou de declaration d'impaye
 * (`markUnpaid`) d'un effet de commerce.
 *
 * Pour `settle()`, la transition depend de l'etat courant :
 *   - receivable `issued`     → D 5121 / C 412
 *   - receivable `discounted` → D 415  / C 412 (l'effet est effectivement
 *                               paye par le client a la banque)
 *   - payable    `issued`     → D 402  / C 5121
 *
 * Pour `markUnpaid()`, l'effet a recevoir bascule en clients douteux :
 *   - receivable `issued`     → D 4131 / C 412
 *   - receivable `discounted` → D 4131 / C 415
 */
export class SettleBillDto {
  /** Date de paiement / d'impaye (ISO YYYY-MM-DD). */
  readonly eventDate!: string;
  /** Code du journal cible (defaut BQ pour paiements, OD pour impaye). */
  readonly journalCode?: string;
  readonly note?: string;
}
