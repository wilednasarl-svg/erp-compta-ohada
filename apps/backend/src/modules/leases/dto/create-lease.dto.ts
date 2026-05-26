import type { LeaseFrequency } from '../types/lease.types';

/**
 * W4.5 — Payload de création d'un contrat de crédit-bail /
 * location-acquisition.
 *
 * Le taux implicite n'est PAS un input — il est calculé par bisection
 * à partir de `fairValue`, `installmentAmount`, `numberOfInstallments`,
 * `purchaseOptionAmount` et `frequency`.
 */
export class CreateLeaseDto {
  readonly contractRef!: string;
  readonly lessorName!: string;
  /** Date de prise d'effet du contrat (ISO YYYY-MM-DD). */
  readonly startDate!: string;
  /** Date de fin contractuelle (ISO YYYY-MM-DD). */
  readonly endDate!: string;
  /** Juste valeur du bien financé, en monnaie locale (> 0). */
  readonly fairValue!: string;
  /** Loyer périodique constant (en monnaie locale, > 0). */
  readonly installmentAmount!: string;
  /** Prix d'exercice de l'option d'achat finale (>= 0). */
  readonly purchaseOptionAmount!: string;
  readonly frequency!: LeaseFrequency;
  /** Nombre total d'échéances (> 0). */
  readonly numberOfInstallments!: number;
  /** ID de l'asset associé (optionnel — peut être lié plus tard). */
  readonly assetId?: string;
  readonly note?: string;
}
