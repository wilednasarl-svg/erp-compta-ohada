import {
  detectAnomalies,
  detectExtremeAmounts,
  detectPotentialDuplicates,
  detectRareAccountJournalCombos,
  detectSensitiveAccounts,
  detectSuspiciousDates,
  type ScannedLine,
} from '../services/anomaly-heuristics';
import { DEFAULT_DETECTOR_CONFIG } from '../types/ai.types';

function line(overrides: Partial<ScannedLine> = {}): ScannedLine {
  return {
    entryId: 'e-default',
    entryDate: '2026-06-15',
    journalCode: 'AC',
    accountId: 'a-624',
    accountCode: '624',
    debit: 10_000,
    credit: 0,
    description: 'normal expense',
    partner: null,
    ...overrides,
  };
}

describe('anomaly-heuristics', () => {
  describe('detectExtremeAmounts', () => {
    it('flags a line whose amount is > 3σ above the account mean', () => {
      const lines: ScannedLine[] = [
        ...Array.from({ length: 6 }, (_, i) =>
          line({ entryId: `e-n-${i}`, debit: 10_000 + i * 500 }),
        ),
        line({ entryId: 'e-outlier', debit: 1_000_000 }),
      ];
      const findings = detectExtremeAmounts(lines);
      expect(findings.length).toBeGreaterThan(0);
      const outlier = findings.find((f) => f.entryId === 'e-outlier');
      expect(outlier).toBeDefined();
      expect(outlier!.anomalyType).toBe('extreme_amount');
      expect(outlier!.riskScore).toBeGreaterThan(0);
    });

    it('does not flag anything when the sample is below the minimum', () => {
      const lines: ScannedLine[] = [
        line({ entryId: 'e1', debit: 10_000 }),
        line({ entryId: 'e2', debit: 12_000 }),
        line({ entryId: 'e3', debit: 1_000_000 }),
      ];
      expect(detectExtremeAmounts(lines)).toEqual([]);
    });

    it('falls back to median multiplier when stddev is degenerate', () => {
      const lines: ScannedLine[] = [
        ...Array.from({ length: 6 }, (_, i) => line({ entryId: `e-${i}`, debit: 10_000 })),
        line({ entryId: 'e-outlier', debit: 100_000 }),
      ];
      const findings = detectExtremeAmounts(lines);
      expect(findings.some((f) => f.entryId === 'e-outlier')).toBe(true);
    });
  });

  describe('detectSensitiveAccounts', () => {
    it('flags every line on the 57x prefix (caisse)', () => {
      const lines: ScannedLine[] = [
        line({ entryId: 'e1', accountId: 'a-571', accountCode: '571', debit: 50_000 }),
        line({ entryId: 'e2', accountCode: '624', debit: 50_000 }),
      ];
      const findings = detectSensitiveAccounts(lines);
      expect(findings).toHaveLength(1);
      expect(findings[0].entryId).toBe('e1');
      expect(findings[0].anomalyType).toBe('sensitive_account');
      expect(findings[0].reasons[0]).toMatch(/Caisse/);
    });

    it('flags 67x charges H.A.O.', () => {
      const lines: ScannedLine[] = [
        line({ entryId: 'e-hao', accountId: 'a-6711', accountCode: '6711', debit: 1_000_000 }),
      ];
      const findings = detectSensitiveAccounts(lines);
      expect(findings).toHaveLength(1);
      expect(findings[0].reasons[0]).toMatch(/hors activité ordinaire/i);
    });
  });

  describe('detectPotentialDuplicates', () => {
    it('flags two lines with same amount/account/journal within the window', () => {
      const lines: ScannedLine[] = [
        line({ entryId: 'e1', entryDate: '2026-06-15', debit: 250_000, partner: 'SODECI' }),
        line({ entryId: 'e2', entryDate: '2026-06-16', debit: 250_000, partner: 'SODECI' }),
      ];
      const findings = detectPotentialDuplicates(lines);
      const ids = new Set(findings.map((f) => f.entryId));
      expect(ids.has('e1')).toBe(true);
      expect(ids.has('e2')).toBe(true);
      expect(findings.every((f) => f.anomalyType === 'potential_duplicate')).toBe(true);
    });

    it('does NOT flag a pair outside the duplicate window', () => {
      const lines: ScannedLine[] = [
        line({ entryId: 'e1', entryDate: '2026-06-01', debit: 250_000 }),
        line({ entryId: 'e2', entryDate: '2026-06-15', debit: 250_000 }),
      ];
      expect(detectPotentialDuplicates(lines)).toEqual([]);
    });

    it('ignores zero-amount lines', () => {
      const lines: ScannedLine[] = [
        line({ entryId: 'e1', debit: 0, credit: 0 }),
        line({ entryId: 'e2', debit: 0, credit: 0 }),
      ];
      expect(detectPotentialDuplicates(lines)).toEqual([]);
    });
  });

  describe('detectSuspiciousDates', () => {
    it('flags a Saturday entry', () => {
      const findings = detectSuspiciousDates(
        [line({ entryId: 'e-sat', entryDate: '2026-06-13' })],
        '2026-01-01',
        '2026-12-31',
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].reasons[0]).toMatch(/samedi/);
    });

    it('flags a date outside the fiscal period', () => {
      const findings = detectSuspiciousDates(
        [line({ entryId: 'e-oop', entryDate: '2027-02-15' })],
        '2026-01-01',
        '2026-12-31',
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].reasons[0]).toMatch(/hors période/);
    });

    it('emits only one finding per entry even if several lines match', () => {
      const findings = detectSuspiciousDates(
        [
          line({ entryId: 'e-multi', entryDate: '2026-06-14' }),
          line({ entryId: 'e-multi', entryDate: '2026-06-14', accountCode: '702' }),
        ],
        '2026-01-01',
        '2026-12-31',
      );
      expect(findings).toHaveLength(1);
    });
  });

  describe('detectRareAccountJournalCombos', () => {
    it('flags a combination below the rarity threshold once the sample is large enough', () => {
      const normal: ScannedLine[] = Array.from({ length: 200 }, (_, i) =>
        line({ entryId: `e-n-${i}`, accountCode: '624', journalCode: 'AC' }),
      );
      const rare = line({
        entryId: 'e-rare',
        accountCode: '701',
        journalCode: 'AC',
        debit: 0,
        credit: 50_000,
      });
      const findings = detectRareAccountJournalCombos([...normal, rare]);
      const rareFinding = findings.find((f) => f.entryId === 'e-rare');
      expect(rareFinding).toBeDefined();
      expect(rareFinding!.anomalyType).toBe('rare_account_journal');
    });

    it('skips when the sample is below the minimum', () => {
      const lines: ScannedLine[] = Array.from({ length: 20 }, (_, i) =>
        line({ entryId: `e-${i}` }),
      );
      expect(detectRareAccountJournalCombos(lines)).toEqual([]);
    });
  });

  describe('detectAnomalies (full pipeline)', () => {
    it('returns findings from multiple heuristics for a stacked scenario', () => {
      const lines: ScannedLine[] = [
        ...Array.from({ length: 10 }, (_, i) =>
          line({ entryId: `e-n-${i}`, debit: 10_000, entryDate: '2026-06-15' }),
        ),
        line({ entryId: 'e-extreme', debit: 2_000_000, entryDate: '2026-06-13' }),
        line({ entryId: 'e-caisse', accountId: 'a-571', accountCode: '571', debit: 200_000 }),
        line({ entryId: 'e-dup1', entryDate: '2026-06-10', debit: 75_000, partner: 'SODECI' }),
        line({ entryId: 'e-dup2', entryDate: '2026-06-11', debit: 75_000, partner: 'SODECI' }),
      ];
      const findings = detectAnomalies(lines, '2026-01-01', '2026-12-31');
      const byType = new Set(findings.map((f) => f.anomalyType));
      expect(byType.has('extreme_amount')).toBe(true);
      expect(byType.has('sensitive_account')).toBe(true);
      expect(byType.has('suspicious_date')).toBe(true);
      expect(byType.has('potential_duplicate')).toBe(true);
    });

    it('respects an injected config override', () => {
      const lines: ScannedLine[] = Array.from({ length: 10 }, (_, i) =>
        line({ entryId: `e-${i}`, debit: 10_000 + i * 100 }),
      );
      lines.push(line({ entryId: 'e-mild', debit: 15_000 }));
      const defaultFindings = detectExtremeAmounts(lines, DEFAULT_DETECTOR_CONFIG);
      const tightFindings = detectExtremeAmounts(lines, {
        ...DEFAULT_DETECTOR_CONFIG,
        extremeAmountSigmas: 1,
        extremeAmountMedianMultiplier: 1.2,
      });
      expect(tightFindings.length).toBeGreaterThanOrEqual(defaultFindings.length);
    });
  });
});
