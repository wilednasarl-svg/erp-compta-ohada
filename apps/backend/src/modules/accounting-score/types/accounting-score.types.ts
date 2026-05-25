/**
 * Module 20 — Accounting Score (wave 1).
 *
 * Score de santé comptable 0-100 calculé par exercice, agrégé sur 4
 * critères pondérés. Heuristique pure (aucun ML/LLM) : reproductible,
 * testable en isolation, explicable par le `breakdown` JSONB.
 *
 * Versionné via `calculated_by` ('heuristic_v1') pour permettre la
 * coexistence avec un futur 'ml_v1' sans migration de schéma.
 */

export type ScoreGrade = 'A' | 'B' | 'C' | 'D';

export type ScoreCriterionKey =
  | 'anomalies'
  | 'missing_justification'
  | 'bank_reconciliation'
  | 'workflow_delays';

/** Source du calcul, versionnée. */
export type ScoreCalculator = 'heuristic_v1';

/**
 * Poids des critères dans le score final (somme = 1.0).
 *
 * Wave 1 — heuristique : on penche fortement sur les anomalies (40%)
 * parce qu'elles capturent une grande partie des autres signaux
 * (date suspecte, compte sensible, doublon, montant extrême).
 * Wave 2 — réviser ces poids à partir de données réelles client.
 */
export const SCORE_WEIGHTS: Readonly<Record<ScoreCriterionKey, number>> = {
  anomalies: 0.4,
  missing_justification: 0.25,
  bank_reconciliation: 0.2,
  workflow_delays: 0.15,
};

/**
 * Seuil de montant (FCFA / XOF) au-delà duquel une écriture est jugée
 * "significative" et doit donc avoir un justificatif. Volontairement bas
 * (50 000 XOF ≈ 76 €) pour piéger la majorité des écritures métier.
 *
 * Wave 2 — rendre configurable par organisation (params multi-tenant).
 */
export const SIGNIFICANT_ENTRY_THRESHOLD = 50_000;

export interface CriterionResult {
  /** Sous-score 0-100 (100 = parfait, 0 = catastrophique). */
  readonly score: number;
  /** Poids appliqué au calcul final. Copié pour audit-trail. */
  readonly weight: number;
  /** Données brutes utilisées — sert à expliquer le score. */
  readonly raw: Record<string, number | string | null>;
}

export interface ScoreBreakdown {
  readonly anomalies: CriterionResult;
  readonly missing_justification: CriterionResult;
  readonly bank_reconciliation: CriterionResult;
  readonly workflow_delays: CriterionResult;
}

export interface ScoreResult {
  /** Score final 0-100, entier arrondi. */
  readonly score: number;
  readonly grade: ScoreGrade;
  readonly breakdown: ScoreBreakdown;
}

/** Source data passée au calculateur pur. */
export interface ScoreInputs {
  readonly anomalies: {
    /** Nb d'écritures validées sur l'exercice (dénominateur). */
    readonly totalValidatedEntries: number;
    /** Nb d'anomalies brutes détectées sur l'exercice. */
    readonly anomaliesCount: number;
    /** Somme des risk_score (0-100 chacun) — capte l'intensité. */
    readonly weightedAnomalyScore: number;
  };
  readonly missingJustification: {
    /** Nb d'écritures jugées significatives (≥ seuil). */
    readonly significantEntries: number;
    /** Nb de ces écritures sans pièce jointe. */
    readonly withoutDocuments: number;
  };
  readonly bankReconciliation: {
    /** Nb total de lignes de relevés bancaires importées sur la période. */
    readonly totalLines: number;
    /** Nb non rapprochées (matchStatus = 'unmatched'). */
    readonly unmatchedLines: number;
  };
  readonly workflowDelays: {
    /** Date de fin de l'exercice (ISO YYYY-MM-DD), null si inconnue. */
    readonly periodEndDate: string | null;
    /** Statut courant de la période ('open' | 'closed'). */
    readonly periodStatus: 'open' | 'closed' | null;
    /** Date de référence (today, ou date passée pour rejouer un calcul). */
    readonly referenceDate: string;
  };
}
