import type { PledgeType } from '../types/pledged-asset.types';

/**
 * E1 — Payload de création d'une sûreté réelle donnée.
 *
 * Tous les montants sont des `string` décimaux NUMERIC(15,2).
 * La validation runtime (Zod / class-validator) est ajoutée par le
 * controller REST en wave 2 ; cette wave 1 ne livre que le service.
 */
export class CreatePledgedAssetDto {
  /** Compte SYSCOHADA de la dette garantie (16x/17x/18x ou 4x partiel). */
  readonly liabilityAccountCode!: string;

  /** Libellé humain de la dette garantie. */
  readonly liabilityLabel!: string;

  /** Montant brut de la dette garantie (string décimal, > 0). */
  readonly brutAmount!: string;

  /** Nature de la sûreté constituée. */
  readonly pledgeType!: PledgeType;

  /** Référence de l'actif donné en garantie. */
  readonly assetReference!: string;

  /** Localisation de l'actif (optionnelle). */
  readonly assetLocation?: string | null;

  /** Nom du créancier bénéficiaire. */
  readonly creditorName!: string;

  /** Date de constitution (ISO YYYY-MM-DD). */
  readonly startDate!: string;

  /**
   * Date d'extinction prévue (ISO YYYY-MM-DD). Doit être >= startDate
   * si fournie (vérifié par le service).
   */
  readonly endDate?: string | null;

  /** Commentaire libre repris dans la note annexe. */
  readonly comment?: string | null;
}
