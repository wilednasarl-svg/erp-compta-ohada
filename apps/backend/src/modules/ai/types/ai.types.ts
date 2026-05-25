/**
 * Module 11 — AI Engine (wave 1).
 *
 * Heuristiques déterministes, aucun appel à un LLM ou modèle externe :
 * tout reste reproductible, testable en isolation, et explicable en
 * français (chaque anomalie porte ses `reasons[]` brutes).
 *
 * Le champ `detected_by` est libellé `heuristic_v1` ; en wave 2 on
 * pourra introduire `ml_v1`, `llm_assistant_v1`, etc. côté même table
 * sans schema change.
 */

/** 5 familles d'anomalies en wave 1 + `semantic_anomaly` en wave 2
 *  (détecté par un LLM). Sérialisé en TEXT côté DB. */
export type AnomalyType =
  | 'extreme_amount'
  | 'sensitive_account'
  | 'potential_duplicate'
  | 'suspicious_date'
  | 'rare_account_journal'
  | 'semantic_anomaly';

export const ANOMALY_TYPES: ReadonlyArray<AnomalyType> = [
  'extreme_amount',
  'sensitive_account',
  'potential_duplicate',
  'suspicious_date',
  'rare_account_journal',
  'semantic_anomaly',
];

/** Source du détecteur, versionnée pour permettre la coexistence
 *  heuristique/LLM côté même table sans migration. */
export type AnomalySource = 'heuristic_v1' | 'llm_v1';

/** Préfixes SYSCOHADA marqués sensibles (caisse + exceptionnels). */
export const SENSITIVE_ACCOUNT_PREFIXES: ReadonlyArray<string> = ['57', '67', '77', '87'];

export interface AnomalyDetectorConfig {
  readonly extremeAmountSigmas: number;
  readonly extremeAmountMedianMultiplier: number;
  readonly extremeAmountMinSample: number;
  readonly duplicateWindowDays: number;
  readonly rareCombinationThreshold: number;
  readonly rareCombinationMinSample: number;
}

export const DEFAULT_DETECTOR_CONFIG: AnomalyDetectorConfig = {
  extremeAmountSigmas: 3,
  extremeAmountMedianMultiplier: 5,
  extremeAmountMinSample: 5,
  duplicateWindowDays: 3,
  rareCombinationThreshold: 0.005,
  rareCombinationMinSample: 200,
};

export const ANOMALY_TYPE_BASE_SCORE: Readonly<Record<AnomalyType, number>> = {
  extreme_amount: 40,
  sensitive_account: 25,
  potential_duplicate: 50,
  suspicious_date: 20,
  rare_account_journal: 30,
  semantic_anomaly: 45,
};
