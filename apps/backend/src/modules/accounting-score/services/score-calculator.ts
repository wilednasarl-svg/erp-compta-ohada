import {
  SCORE_WEIGHTS,
  type CriterionResult,
  type ScoreBreakdown,
  type ScoreGrade,
  type ScoreInputs,
  type ScoreResult,
} from '../types/accounting-score.types';

/**
 * Module 20 wave 1 — calculateur pur (aucune dépendance Nest / DB / I/O).
 *
 * Chaque critère est une fonction pure prenant ses inputs structurés
 * et renvoyant un sous-score 0-100. Le score final est la moyenne
 * pondérée arrondie. Le grade dérive de seuils fixes.
 *
 * Tests : `__tests__/score-calculator.spec.ts`.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Borne une valeur dans [0, 100] et arrondit à l'entier. */
function clamp100(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Anomalies — convertit l'intensité d'anomalies par écriture en sous-score.
 *
 * Heuristique : on calcule `intensity = weightedAnomalyScore / totalEntries`.
 * - 0          → 100 (aucune anomalie)
 * - 50 (= chaque écriture a une anomalie risk_score=50) → 0
 * - linéaire entre les deux, borné.
 *
 * Si totalValidatedEntries === 0, on retourne 100 (rien à juger).
 */
export function scoreAnomalies(input: ScoreInputs['anomalies']): CriterionResult {
  const { totalValidatedEntries, anomaliesCount, weightedAnomalyScore } = input;
  const denom = Math.max(totalValidatedEntries, 1);
  const intensity = weightedAnomalyScore / denom;
  // intensity 0..50 mappé sur 100..0
  const subScore = clamp100(100 - intensity * 2);
  return {
    score: totalValidatedEntries === 0 ? 100 : subScore,
    weight: SCORE_WEIGHTS.anomalies,
    raw: {
      totalValidatedEntries,
      anomaliesCount,
      weightedAnomalyScore,
      intensity: Math.round(intensity * 100) / 100,
    },
  };
}

/**
 * Justificatifs manquants — pénalise proportionnellement.
 *
 * Heuristique : `ratio = withoutDocuments / significantEntries`.
 * subScore = 100 * (1 - ratio). Pas de seuil de tolérance en wave 1.
 *
 * Si aucune écriture significative, on retourne 100 (rien à juger).
 */
export function scoreMissingJustification(
  input: ScoreInputs['missingJustification'],
): CriterionResult {
  const { significantEntries, withoutDocuments } = input;
  if (significantEntries === 0) {
    return {
      score: 100,
      weight: SCORE_WEIGHTS.missing_justification,
      raw: { significantEntries: 0, withoutDocuments: 0, ratio: 0 },
    };
  }
  const ratio = withoutDocuments / significantEntries;
  return {
    score: clamp100(100 * (1 - ratio)),
    weight: SCORE_WEIGHTS.missing_justification,
    raw: {
      significantEntries,
      withoutDocuments,
      ratio: Math.round(ratio * 1000) / 1000,
    },
  };
}

/**
 * Rapprochement bancaire — pénalise les lignes non rapprochées.
 *
 * Heuristique : `ratio = unmatched / total`. subScore = 100 * (1 - ratio).
 * Si `totalLines === 0` (aucun relevé importé), on retourne 100 — on ne
 * peut pas pénaliser ce qui n'existe pas. C'est volontairement neutre :
 * un exercice "vide côté banque" ne doit pas baisser le score global.
 */
export function scoreBankReconciliation(input: ScoreInputs['bankReconciliation']): CriterionResult {
  const { totalLines, unmatchedLines } = input;
  if (totalLines === 0) {
    return {
      score: 100,
      weight: SCORE_WEIGHTS.bank_reconciliation,
      raw: { totalLines: 0, unmatchedLines: 0, ratio: 0 },
    };
  }
  const ratio = unmatchedLines / totalLines;
  return {
    score: clamp100(100 * (1 - ratio)),
    weight: SCORE_WEIGHTS.bank_reconciliation,
    raw: {
      totalLines,
      unmatchedLines,
      ratio: Math.round(ratio * 1000) / 1000,
    },
  };
}

/**
 * Retards workflow — pénalise les exercices restés "open" longtemps
 * après la fin de période.
 *
 * Statut DB : 'open' | 'closed'.
 *   - closed                → 100 (exercice clôturé proprement)
 *   - open + pas dépassé    → 100
 *   - open + ≤ 30j retard   → 90
 *   - open + ≤ 60j retard   → 70
 *   - open + ≤ 90j retard   → 50
 *   - open + ≤ 180j retard  → 25
 *   - open + > 180j retard  → 0
 *
 * Si `periodEndDate` ou `periodStatus` est null (période introuvable),
 * on retourne 100 (neutre — la donnée manque, on ne pénalise pas).
 */
export function scoreWorkflowDelays(input: ScoreInputs['workflowDelays']): CriterionResult {
  const { periodEndDate, periodStatus, referenceDate } = input;

  if (periodStatus === 'closed') {
    return {
      score: 100,
      weight: SCORE_WEIGHTS.workflow_delays,
      raw: { periodStatus: 'closed', periodEndDate, daysOverdue: 0 },
    };
  }
  if (periodEndDate === null || periodStatus === null) {
    return {
      score: 100,
      weight: SCORE_WEIGHTS.workflow_delays,
      raw: { periodStatus, periodEndDate, daysOverdue: 0 },
    };
  }

  const endTs = Date.parse(periodEndDate);
  const refTs = Date.parse(referenceDate);
  if (!Number.isFinite(endTs) || !Number.isFinite(refTs)) {
    return {
      score: 100,
      weight: SCORE_WEIGHTS.workflow_delays,
      raw: { periodStatus, periodEndDate, daysOverdue: 0 },
    };
  }

  const daysOverdue = Math.max(0, Math.floor((refTs - endTs) / MS_PER_DAY));
  let subScore: number;
  if (daysOverdue === 0) subScore = 100;
  else if (daysOverdue <= 30) subScore = 90;
  else if (daysOverdue <= 60) subScore = 70;
  else if (daysOverdue <= 90) subScore = 50;
  else if (daysOverdue <= 180) subScore = 25;
  else subScore = 0;

  return {
    score: subScore,
    weight: SCORE_WEIGHTS.workflow_delays,
    raw: { periodStatus, periodEndDate, daysOverdue },
  };
}

/**
 * Grade lettré à partir du score final.
 *   ≥ 85 → A
 *   ≥ 70 → B
 *   ≥ 50 → C
 *   sinon → D
 */
export function gradeForScore(score: number): ScoreGrade {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

/**
 * Calcule le score final pondéré + breakdown + grade.
 *
 * Invariant : `score` ∈ [0, 100] entier, `grade` ∈ {A,B,C,D},
 * `breakdown` contient les 4 critères avec leur sous-score et `raw`.
 */
export function calculateScore(inputs: ScoreInputs): ScoreResult {
  const breakdown: ScoreBreakdown = {
    anomalies: scoreAnomalies(inputs.anomalies),
    missing_justification: scoreMissingJustification(inputs.missingJustification),
    bank_reconciliation: scoreBankReconciliation(inputs.bankReconciliation),
    workflow_delays: scoreWorkflowDelays(inputs.workflowDelays),
  };

  const weighted =
    breakdown.anomalies.score * breakdown.anomalies.weight +
    breakdown.missing_justification.score * breakdown.missing_justification.weight +
    breakdown.bank_reconciliation.score * breakdown.bank_reconciliation.weight +
    breakdown.workflow_delays.score * breakdown.workflow_delays.weight;

  const score = clamp100(weighted);
  return { score, grade: gradeForScore(score), breakdown };
}
