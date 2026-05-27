import type { PledgeType } from '../types/pledged-asset.types';

/**
 * E1 — Payload de mise à jour d'une sûreté.
 *
 * Toutes les propriétés sont optionnelles. Le service refuse les
 * updates si la sûreté n'est pas en statut `active`
 * (PLEDGED_ASSET_NOT_ACTIVE).
 */
export class UpdatePledgedAssetDto {
  readonly liabilityAccountCode?: string;
  readonly liabilityLabel?: string;
  readonly brutAmount?: string;
  readonly pledgeType?: PledgeType;
  readonly assetReference?: string;
  readonly assetLocation?: string | null;
  readonly creditorName?: string;
  readonly startDate?: string;
  readonly endDate?: string | null;
  readonly comment?: string | null;
}
