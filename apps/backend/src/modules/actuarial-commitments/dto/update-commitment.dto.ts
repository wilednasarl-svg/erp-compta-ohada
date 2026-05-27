/**
 * E2 — Payload de mise à jour d'une évaluation actuarielle.
 *
 * Tous les champs sont optionnels — patch partiel. `obligationAmount` et
 * `provisionedAmount` sont re-validés par le service
 * (overflow ⇒ ACTUARIAL_COMMITMENT_PROVISION_OVERFLOW).
 */
export class UpdateActuarialCommitmentDto {
  readonly label?: string;
  readonly valuationDate?: string;
  readonly obligationAmount?: string;
  readonly provisionedAmount?: string;
  readonly discountRate?: string;
  readonly mortalityTable?: string;
  readonly staffTurnover?: string | null;
  readonly salaryGrowthRate?: string | null;
  readonly methodology?: string;
  readonly actuaryName?: string | null;
  readonly comment?: string | null;
}
