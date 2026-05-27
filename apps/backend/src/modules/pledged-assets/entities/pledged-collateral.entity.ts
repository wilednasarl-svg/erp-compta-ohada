/**
 * `PledgedCollateralEntity` — réservé pour la wave suivante.
 *
 * À ce stade (E1), une sûreté donnée est portée à plat par
 * `PledgedAssetEntity` (un seul actif + un seul créancier). Si la
 * doctrine impose plus tard une cardinalité N:M (plusieurs actifs
 * nantis pour une même dette, ou un même actif gageant plusieurs
 * dettes), on extraira la nature collatérale ici.
 *
 * Ce fichier est volontairement non-TypeORM dans cette wave pour
 * éviter une migration de table inutile.
 */

import type { PledgeType } from '../types/pledged-asset.types';

/**
 * Vue d'un collatéral attaché à une sûreté. Aujourd'hui projeté
 * directement depuis `PledgedAssetEntity` ; sera ré-extrait en table
 * dédiée si la cardinalité évolue.
 */
export interface PledgedCollateral {
  readonly pledgedAssetId: string;
  readonly pledgeType: PledgeType;
  readonly assetReference: string;
  readonly assetLocation: string | null;
  readonly amountSecured: string;
}
