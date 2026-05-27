import type { ActuarialCommitmentType } from '../types/actuarial-commitment.types';

/**
 * E2 — Payload de création d'une évaluation actuarielle.
 *
 * Tous les montants sont passés en string NUMERIC(15,2) "0.00" pour
 * préserver la précision et rester cohérent avec le reste du projet.
 */
export class CreateActuarialCommitmentDto {
  readonly commitmentType!: ActuarialCommitmentType;
  readonly label!: string;
  readonly valuationDate!: string;
  readonly obligationAmount!: string;
  readonly provisionedAmount?: string;
  readonly discountRate!: string;
  readonly mortalityTable!: string;
  readonly staffTurnover?: string | null;
  readonly salaryGrowthRate?: string | null;
  readonly methodology!: string;
  readonly actuaryName?: string | null;
  readonly comment?: string | null;
}
