/**
 * Module 12 — Immobilisations & Amortissements (SYSCOHADA).
 *
 * `linear` / `declining` : méthodes de base (Wave 1).
 * `softy` : SOFTY (Sum-Of-The-Years' Digits) — annuité décroissante,
 *   poids = (durée − N + 1) / Σ(1..durée). Tome 2 chap 4-5, App. 27-32.
 * `units_of_production` : UOP / unités d'œuvre. Dotation N =
 *   brut × (unitsPerYear[N] / totalUnits).
 *
 * Amortissements dérogatoires (R34) : écart entre amort. fiscal autorisé
 * et amort. économique. Différence positive constatée en provision
 * réglementée 851/151 ; reprise en 151/861.
 */

export type DepreciationMethod =
  | 'linear'
  | 'declining'
  | 'softy'
  | 'units_of_production';
export type AssetStatus = 'active' | 'fully_depreciated' | 'disposed';
export type DepreciationStatus = 'pending' | 'posted';

export const DEPRECIATION_METHODS: ReadonlyArray<DepreciationMethod> = [
  'linear',
  'declining',
  'softy',
  'units_of_production',
];
export const ASSET_STATUSES: ReadonlyArray<AssetStatus> = [
  'active',
  'fully_depreciated',
  'disposed',
];

/** Configuration dérogatoire fiscale vs économique. */
export interface DerogatoryConfig {
  readonly enabled: boolean;
  readonly fiscalMethod: DepreciationMethod;
  readonly economicMethod: DepreciationMethod;
  readonly fiscalDuration?: number;
  readonly fiscalDecliningRate?: string | number | null;
}
