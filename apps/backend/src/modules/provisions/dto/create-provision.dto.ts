import type { ProvisionType } from '../types/provision.types';

/**
 * W3.1 — Payload de creation d'une provision.
 *
 * `initialAmount` est aussi la dotation initiale : la creation pose
 * automatiquement une ecriture comptable D 691x|697x / C 19x via
 * `EntriesService`. La provision part directement avec
 * `currentAmount = initialAmount` et `status = 'active'`.
 */
export class CreateProvisionDto {
  readonly type!: ProvisionType;
  readonly label!: string;
  /** Montant initialement provisionne (en monnaie locale, > 0). */
  readonly initialAmount!: string;
  /** Date d'effet comptable (ISO YYYY-MM-DD). */
  readonly effectiveDate!: string;
  /** Code du journal cible (defaut OD si non fourni). */
  readonly journalCode?: string;
  /** Note libre attachee au mouvement de dotation. */
  readonly note?: string;
}
