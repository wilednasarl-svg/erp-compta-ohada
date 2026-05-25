import {
  calculateScore,
  gradeForScore,
  scoreAnomalies,
  scoreBankReconciliation,
  scoreMissingJustification,
  scoreWorkflowDelays,
} from '../services/score-calculator';
import { SCORE_WEIGHTS, type ScoreInputs } from '../types/accounting-score.types';

function cleanInputs(): ScoreInputs {
  return {
    anomalies: {
      totalValidatedEntries: 200,
      anomaliesCount: 0,
      weightedAnomalyScore: 0,
    },
    missingJustification: {
      significantEntries: 50,
      withoutDocuments: 0,
    },
    bankReconciliation: {
      totalLines: 120,
      unmatchedLines: 0,
    },
    workflowDelays: {
      periodEndDate: '2026-12-31',
      periodStatus: 'closed',
      referenceDate: '2026-05-25',
    },
  };
}

function dirtyInputs(): ScoreInputs {
  // 200 écritures dont 80 portent une anomalie risk_score moyen 60.
  // weightedAnomalyScore = 80 * 60 = 4800. intensity = 24. subScore = 100 - 48 = 52.
  return {
    anomalies: {
      totalValidatedEntries: 200,
      anomaliesCount: 80,
      weightedAnomalyScore: 4800,
    },
    missingJustification: {
      significantEntries: 50,
      withoutDocuments: 40, // 80% sans pièce
    },
    bankReconciliation: {
      totalLines: 120,
      unmatchedLines: 90, // 75% non rapprochées
    },
    workflowDelays: {
      // Exercice 2024 toujours "open" un an plus tard → 145j retard
      periodEndDate: '2025-12-31',
      periodStatus: 'open',
      referenceDate: '2026-05-25',
    },
  };
}

describe('score-calculator', () => {
  describe('gradeForScore', () => {
    it.each([
      [100, 'A'],
      [85, 'A'],
      [84, 'B'],
      [70, 'B'],
      [69, 'C'],
      [50, 'C'],
      [49, 'D'],
      [0, 'D'],
    ])('maps score %d → grade %s', (score, expected) => {
      expect(gradeForScore(score)).toBe(expected);
    });
  });

  describe('scoreAnomalies', () => {
    it('returns 100 when there are no validated entries (rien à juger)', () => {
      const r = scoreAnomalies({
        totalValidatedEntries: 0,
        anomaliesCount: 0,
        weightedAnomalyScore: 0,
      });
      expect(r.score).toBe(100);
      expect(r.weight).toBe(SCORE_WEIGHTS.anomalies);
    });

    it('returns 100 when there are entries but zero anomalies', () => {
      const r = scoreAnomalies({
        totalValidatedEntries: 100,
        anomaliesCount: 0,
        weightedAnomalyScore: 0,
      });
      expect(r.score).toBe(100);
    });

    it('drops to 0 when intensity is overwhelming (every entry has a max-score anomaly)', () => {
      const r = scoreAnomalies({
        totalValidatedEntries: 100,
        anomaliesCount: 100,
        weightedAnomalyScore: 10_000, // 100 entries × risk_score 100
      });
      expect(r.score).toBe(0);
    });

    it('produces a middling score for medium intensity', () => {
      // intensity = 25 → subScore = 100 - 50 = 50
      const r = scoreAnomalies({
        totalValidatedEntries: 100,
        anomaliesCount: 50,
        weightedAnomalyScore: 2500,
      });
      expect(r.score).toBe(50);
      expect(r.raw.intensity).toBe(25);
    });
  });

  describe('scoreMissingJustification', () => {
    it('returns 100 when no significant entries exist', () => {
      const r = scoreMissingJustification({ significantEntries: 0, withoutDocuments: 0 });
      expect(r.score).toBe(100);
    });

    it('returns 100 when every significant entry has a document', () => {
      const r = scoreMissingJustification({ significantEntries: 30, withoutDocuments: 0 });
      expect(r.score).toBe(100);
    });

    it('returns 0 when every significant entry is missing its document', () => {
      const r = scoreMissingJustification({ significantEntries: 30, withoutDocuments: 30 });
      expect(r.score).toBe(0);
    });

    it('scales linearly with the ratio', () => {
      const r = scoreMissingJustification({ significantEntries: 100, withoutDocuments: 30 });
      expect(r.score).toBe(70);
      expect(r.raw.ratio).toBe(0.3);
    });
  });

  describe('scoreBankReconciliation', () => {
    it('returns 100 when no bank lines exist (neutre, pas de pénalité)', () => {
      const r = scoreBankReconciliation({ totalLines: 0, unmatchedLines: 0 });
      expect(r.score).toBe(100);
    });

    it('returns 100 when all lines are matched', () => {
      const r = scoreBankReconciliation({ totalLines: 80, unmatchedLines: 0 });
      expect(r.score).toBe(100);
    });

    it('drops to 0 when nothing is matched', () => {
      const r = scoreBankReconciliation({ totalLines: 80, unmatchedLines: 80 });
      expect(r.score).toBe(0);
    });

    it('scales linearly with unmatched ratio', () => {
      const r = scoreBankReconciliation({ totalLines: 100, unmatchedLines: 40 });
      expect(r.score).toBe(60);
    });
  });

  describe('scoreWorkflowDelays', () => {
    it('returns 100 for a closed period regardless of how old it is', () => {
      const r = scoreWorkflowDelays({
        periodEndDate: '2020-12-31',
        periodStatus: 'closed',
        referenceDate: '2026-05-25',
      });
      expect(r.score).toBe(100);
    });

    it('returns 100 for an open period that has not yet ended', () => {
      const r = scoreWorkflowDelays({
        periodEndDate: '2026-12-31',
        periodStatus: 'open',
        referenceDate: '2026-05-25',
      });
      expect(r.score).toBe(100);
      expect(r.raw.daysOverdue).toBe(0);
    });

    it('returns 90 within 30 days overdue', () => {
      const r = scoreWorkflowDelays({
        periodEndDate: '2026-05-01',
        periodStatus: 'open',
        referenceDate: '2026-05-25',
      });
      expect(r.score).toBe(90);
    });

    it('returns 0 when overdue more than 180 days', () => {
      const r = scoreWorkflowDelays({
        periodEndDate: '2025-01-01',
        periodStatus: 'open',
        referenceDate: '2026-05-25',
      });
      expect(r.score).toBe(0);
    });

    it('falls back to 100 when period data is missing (neutre)', () => {
      const r = scoreWorkflowDelays({
        periodEndDate: null,
        periodStatus: null,
        referenceDate: '2026-05-25',
      });
      expect(r.score).toBe(100);
    });
  });

  describe('calculateScore — end-to-end', () => {
    it('produces a high A-grade score on a clean exercise', () => {
      const r = calculateScore(cleanInputs());
      expect(r.score).toBe(100);
      expect(r.grade).toBe('A');
      expect(r.breakdown.anomalies.score).toBe(100);
      expect(r.breakdown.missing_justification.score).toBe(100);
      expect(r.breakdown.bank_reconciliation.score).toBe(100);
      expect(r.breakdown.workflow_delays.score).toBe(100);
    });

    it('produces a low D-grade score on a dirty exercise', () => {
      const r = calculateScore(dirtyInputs());
      // anomalies=52*.4 + missing=20*.25 + bank=25*.20 + workflow=25*.15
      // = 20.8 + 5 + 5 + 3.75 = 34.55 → 35
      expect(r.score).toBeLessThanOrEqual(40);
      expect(r.grade).toBe('D');
      expect(r.breakdown.anomalies.score).toBeLessThan(70);
      expect(r.breakdown.missing_justification.score).toBeLessThan(30);
      expect(r.breakdown.bank_reconciliation.score).toBeLessThan(30);
      expect(r.breakdown.workflow_delays.score).toBeLessThan(30);
    });

    it('weights sum to 1 across the breakdown', () => {
      const r = calculateScore(cleanInputs());
      const sum =
        r.breakdown.anomalies.weight +
        r.breakdown.missing_justification.weight +
        r.breakdown.bank_reconciliation.weight +
        r.breakdown.workflow_delays.weight;
      expect(sum).toBeCloseTo(1.0, 5);
    });

    it('clamps the final score to the [0, 100] range and rounds to an integer', () => {
      const r = calculateScore(dirtyInputs());
      expect(Number.isInteger(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    });
  });
});
