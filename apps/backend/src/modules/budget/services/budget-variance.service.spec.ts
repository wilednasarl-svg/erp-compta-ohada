import { asTenantId } from '../../../common/persistence/tenant-scope';
import type {
  BudgetVarianceRepository,
  VarianceRow,
} from '../repositories/budget-variance.repository';
import { BudgetVarianceService } from './budget-variance.service';

function makeService(rows: VarianceRow[]): BudgetVarianceService {
  const repo = {
    computeVariance: jest.fn().mockResolvedValue(rows),
  } as unknown as BudgetVarianceRepository;
  return new BudgetVarianceService(repo);
}

const ORG = asTenantId('11111111-1111-1111-1111-111111111111');

describe('BudgetVarianceService', () => {
  it('marks a charge overspend as unfavorable (réalisé > budget sur une charge)', async () => {
    const service = makeService([
      {
        dimension: '6221',
        dimensionLabel: 'Locations',
        budget: '1500000.00',
        actual: '1620000.00',
      },
    ]);

    const report = await service.report(ORG, { fiscalYear: 2026, groupBy: 'account' });
    const row = report.rows[0];

    expect(row.variance).toBe('120000.00');
    expect(row.variancePct).toBe(8);
    expect(row.realizationPct).toBe(108);
    expect(row.favorable).toBe(false);
  });

  it('marks a revenue beat as favorable (réalisé > budget sur un produit, classe 7)', async () => {
    const service = makeService([
      { dimension: '7011', dimensionLabel: 'Ventes', budget: '45000000.00', actual: '50000000.00' },
    ]);

    const report = await service.report(ORG, { fiscalYear: 2026, groupBy: 'account' });
    const row = report.rows[0];

    expect(row.variance).toBe('5000000.00');
    expect(row.favorable).toBe(true);
  });

  it('aggregates totals across rows', async () => {
    const service = makeService([
      { dimension: '6221', dimensionLabel: 'Loc', budget: '1500000.00', actual: '1620000.00' },
      { dimension: '6011', dimensionLabel: 'Achats', budget: '1000000.00', actual: '900000.00' },
    ]);

    const report = await service.report(ORG, { fiscalYear: 2026, groupBy: 'account' });

    expect(report.totalBudget).toBe('2500000.00');
    expect(report.totalActual).toBe('2520000.00');
    expect(report.totalVariance).toBe('20000.00');
  });

  it('uses the cost perspective for non-account groupings (écart ≤ 0 favorable)', async () => {
    const service = makeService([
      {
        dimension: 'COST-CENTER-UUID',
        dimensionLabel: 'COMM',
        budget: '1000000.00',
        actual: '950000.00',
      },
    ]);

    const report = await service.report(ORG, { fiscalYear: 2026, groupBy: 'cost_center' });

    expect(report.rows[0].variance).toBe('-50000.00');
    expect(report.rows[0].favorable).toBe(true);
  });
});
