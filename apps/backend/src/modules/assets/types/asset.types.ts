/**
 * Module 12 — Immobilisations & Amortissements (SYSCOHADA).
 *
 * Vocabulaire métier :
 *   - `linear`    : amortissement constant sur la durée. Dotation =
 *     (coût - valeur résiduelle) / durée. Prorata du nombre de mois en
 *     service la première et la dernière année.
 *   - `declining` : amortissement dégressif. Taux fixe appliqué à la
 *     valeur nette comptable (VNC) en début d'exercice. On bascule sur
 *     linéaire quand la dotation linéaire devient supérieure au
 *     dégressif (règle SYSCOHADA).
 *
 * `active` → bien en cours d'amortissement (status par défaut).
 * `fully_depreciated` → VNC = valeur résiduelle ; plus de dotation à venir.
 * `disposed` → bien cédé ou mis au rebut ; l'échéancier restant est
 *     annulé (les `depreciation_schedules` pending sont supprimés).
 */

export type DepreciationMethod = 'linear' | 'declining';
export type AssetStatus = 'active' | 'fully_depreciated' | 'disposed';
export type DepreciationStatus = 'pending' | 'posted';

export const DEPRECIATION_METHODS: ReadonlyArray<DepreciationMethod> = ['linear', 'declining'];
export const ASSET_STATUSES: ReadonlyArray<AssetStatus> = [
  'active',
  'fully_depreciated',
  'disposed',
];
