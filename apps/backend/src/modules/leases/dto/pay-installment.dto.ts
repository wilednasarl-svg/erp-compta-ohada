/**
 * W4.5 — Payload de paiement d'une échéance de crédit-bail.
 *
 * Le montant payé est figé par l'amortissement (`installment.totalAmount`)
 * — pas surchargeable par le DTO. L'utilisateur ne fournit que la date
 * réelle du décaissement et une note optionnelle.
 */
export class PayInstallmentDto {
  /** Date réelle du décaissement bancaire (ISO YYYY-MM-DD). */
  readonly paymentDate!: string;
  readonly note?: string;
}
