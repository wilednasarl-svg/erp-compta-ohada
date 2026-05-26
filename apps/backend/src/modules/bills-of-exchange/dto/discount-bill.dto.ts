/**
 * W4.6 — Payload d'escompte d'un effet a recevoir.
 *
 * Ecriture posee : D 5121 net + D 6745 escompte + D 6312 frais / C 415
 * nominal. `netAmount = nominalAmount - discountFee - bankFee` doit
 * rester strictement positif (sinon BILL_NEGATIVE_NET).
 */
export class DiscountBillDto {
  /** Date d'escompte (ISO YYYY-MM-DD). */
  readonly eventDate!: string;
  /** Escompte bancaire (agio) — charge financiere 6745. */
  readonly discountFee!: string;
  /** Frais bancaires (services bancaires) — charge 6312. */
  readonly bankFee!: string;
  /** Code du journal cible (defaut BQ si non fourni). */
  readonly journalCode?: string;
  readonly note?: string;
}
