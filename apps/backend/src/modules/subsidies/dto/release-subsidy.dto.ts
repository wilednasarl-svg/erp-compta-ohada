/**
 * W4.4 — Payload d'une reprise manuelle de subvention au résultat.
 *
 * Réservé à `releaseMethod === 'manual'` : le caller choisit librement
 * le montant et la date. Pour `on_depreciation`, la reprise est dérivée
 * de la dotation d'amortissement postée. Pour `linear_10y`, elle est
 * mensuelle automatique (totalAmount / 120).
 */
export class ReleaseSubsidyDto {
  /** Montant à reprendre (NUMERIC 15,2 — chaîne "0.00", > 0). */
  readonly amount!: string;

  /** Date de reprise (ISO YYYY-MM-DD). */
  readonly releaseDate!: string;

  /** Code du journal cible (défaut OD si non fourni). */
  readonly journalCode?: string;

  /** Note libre attachée à l'écriture de reprise. */
  readonly note?: string;
}
