import type { VarianceReportResult } from '../services/budget-variance.service';
import { toBudgetVarianceReport } from './budget-variance.mapper';

function buildResult(overrides: Partial<VarianceReportResult> = {}): VarianceReportResult {
  return {
    fiscalYear: 2026,
    budgetScenario: 'BI',
    groupBy: 'account',
    rows: [
      {
        dimension: '604000',
        dimensionLabel: 'Achats stockés',
        budget: '1000000.00',
        actual: '900000.00',
        variance: '-100000.00',
        variancePct: -10,
        favorable: true,
        realizationPct: 90,
      },
      {
        dimension: null,
        dimensionLabel: null,
        budget: '0.00',
        actual: '50000.00',
        variance: '50000.00',
        variancePct: null,
        favorable: false,
        realizationPct: null,
      },
    ],
    totalBudget: '1000000.00',
    totalActual: '950000.00',
    totalVariance: '-50000.00',
    ...overrides,
  };
}

describe('budget-variance.mapper', () => {
  it('maps the report header and totals verbatim', () => {
    const dto = toBudgetVarianceReport(buildResult());

    expect(dto.fiscalYear).toBe(2026);
    expect(dto.budgetScenario).toBe('BI');
    expect(dto.groupBy).toBe('account');
    expect(dto.totalBudget).toBe('1000000.00');
    expect(dto.totalActual).toBe('950000.00');
    expect(dto.totalVariance).toBe('-50000.00');
  });

  it('maps every row field including null dimension and null percentages', () => {
    const dto = toBudgetVarianceReport(buildResult());

    expect(dto.rows).toHaveLength(2);
    expect(dto.rows[0]).toEqual({
      dimension: '604000',
      dimensionLabel: 'Achats stockés',
      budget: '1000000.00',
      actual: '900000.00',
      variance: '-100000.00',
      variancePct: -10,
      favorable: true,
      realizationPct: 90,
    });
    expect(dto.rows[1]?.dimension).toBeNull();
    expect(dto.rows[1]?.variancePct).toBeNull();
    expect(dto.rows[1]?.realizationPct).toBeNull();
    expect(dto.rows[1]?.favorable).toBe(false);
  });

  it('produces a fresh rows array (no shared reference with the source)', () => {
    const result = buildResult();
    const dto = toBudgetVarianceReport(result);
    expect(dto.rows).not.toBe(result.rows);
  });

  it('handles an empty rows set', () => {
    const dto = toBudgetVarianceReport(buildResult({ rows: [] }));
    expect(dto.rows).toEqual([]);
  });
});
