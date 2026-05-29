import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AccountingPeriodEntity } from '../../journals/entities/accounting-period.entity';
import type {
  MonthlyClassRow,
  MonthlyPrefixRow,
  TopAccountFlowRow,
} from '../repositories/dashboards.repository';
import { DashboardAnalyticsService, listMonths } from '../services/dashboard-analytics.service';

const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
const EXERCISE_ID = '00000000-0000-4000-8000-000000000002';

const FAKE_PERIOD = {
  id: EXERCISE_ID,
  organizationId: ORG_ID,
  parentId: null,
  kind: 'ANNUAL',
  label: 'Exercice 2026',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  status: 'open',
  closedAt: null,
  closedBy: null,
  reopenedReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as AccountingPeriodEntity;

function buildService(
  opts: {
    cashflowRows?: MonthlyPrefixRow[];
    evolutionRows?: MonthlyClassRow[];
    topFlowRows?: TopAccountFlowRow[];
    period?: AccountingPeriodEntity | null;
  } = {},
) {
  const dashRepo = {
    aggregateByClass: jest.fn(),
    aggregateByCodePrefix: jest.fn(),
    unletteredLinesByCodePrefix: jest.fn(),
    monthlyAggregateByCodePrefix: jest.fn().mockResolvedValue(opts.cashflowRows ?? []),
    monthlyAggregateByClass: jest.fn().mockResolvedValue(opts.evolutionRows ?? []),
    accountFlowsByClass: jest.fn().mockResolvedValue(opts.topFlowRows ?? []),
  };
  const periodsRepo = {
    findById: jest.fn().mockResolvedValue(opts.period === undefined ? FAKE_PERIOD : opts.period),
  };
  return {
    service: new DashboardAnalyticsService(dashRepo as never, periodsRepo as never),
    dashRepo,
    periodsRepo,
  };
}

describe('listMonths helper', () => {
  it('enumerates 12 months for a calendar year', () => {
    const months = listMonths('2026-01-01', '2026-12-31');
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ start: '2026-01-01', end: '2026-01-31', label: 'Janv. 2026' });
    expect(months[11]).toEqual({ start: '2026-12-01', end: '2026-12-31', label: 'Déc. 2026' });
  });

  it('handles an offset fiscal year (April → March)', () => {
    const months = listMonths('2026-04-01', '2027-03-31');
    expect(months).toHaveLength(12);
    expect(months[0]?.label).toBe('Avr. 2026');
    expect(months[11]?.label).toBe('Mars 2027');
  });

  it('handles February (non-leap)', () => {
    const months = listMonths('2026-02-01', '2026-02-28');
    expect(months[0]).toEqual({ start: '2026-02-01', end: '2026-02-28', label: 'Févr. 2026' });
  });

  it('returns empty when from > to', () => {
    expect(listMonths('2026-12-01', '2026-01-01')).toEqual([]);
  });
});

describe('DashboardAnalyticsService.getCashflow', () => {
  it('produces a continuous monthly series with zero-fill on inactive months', async () => {
    const { service } = buildService({
      cashflowRows: [
        // Activity in Jan and Mar only — Feb is empty.
        { month: '2026-01-01', totalDebit: '5000000.00', totalCredit: '2000000.00' },
        { month: '2026-03-01', totalDebit: '1000000.00', totalCredit: '500000.00' },
      ],
      period: {
        ...FAKE_PERIOD,
        startDate: '2026-01-01',
        endDate: '2026-03-31',
      } as unknown as AccountingPeriodEntity,
    });

    const cashflow = await service.getCashflow(ORG_ID, EXERCISE_ID);
    expect(cashflow.points).toHaveLength(3);

    const [jan, feb, mar] = cashflow.points;
    expect(jan?.inflow).toBe('5000000.00');
    expect(jan?.outflow).toBe('2000000.00');
    expect(jan?.netFlow).toBe('3000000.00');
    expect(jan?.closingBalance).toBe('3000000.00');

    expect(feb?.inflow).toBe('0.00');
    expect(feb?.outflow).toBe('0.00');
    expect(feb?.netFlow).toBe('0.00');
    expect(feb?.closingBalance).toBe('3000000.00'); // cumulative tient

    expect(mar?.netFlow).toBe('500000.00');
    expect(mar?.closingBalance).toBe('3500000.00');

    expect(cashflow.totals.inflow).toBe('6000000.00');
    expect(cashflow.totals.outflow).toBe('2500000.00');
    expect(cashflow.totals.netFlow).toBe('3500000.00');
  });

  it('throws ACCOUNTING_PERIOD_NOT_FOUND when exercise missing', async () => {
    const { service } = buildService({ period: null });
    await expect(service.getCashflow(ORG_ID, EXERCISE_ID)).rejects.toMatchObject({
      code: 'ACCOUNTING_PERIOD_NOT_FOUND',
    });
  });
});

describe('DashboardAnalyticsService.getEvolution', () => {
  it('pivots monthly class rows into revenue/expenses/net per month', async () => {
    const { service } = buildService({
      evolutionRows: [
        { month: '2026-01-01', accountClass: 7, totalDebit: '0', totalCredit: '10000.00' },
        { month: '2026-01-01', accountClass: 6, totalDebit: '4000.00', totalCredit: '0' },
        { month: '2026-02-01', accountClass: 7, totalDebit: '0', totalCredit: '15000.00' },
        // No expense in Feb
      ],
      period: {
        ...FAKE_PERIOD,
        startDate: '2026-01-01',
        endDate: '2026-02-28',
      } as unknown as AccountingPeriodEntity,
    });

    const evo = await service.getEvolution(ORG_ID, EXERCISE_ID);
    expect(evo.points).toHaveLength(2);

    const [jan, feb] = evo.points;
    expect(jan?.revenue).toBe('10000.00');
    expect(jan?.expenses).toBe('4000.00');
    expect(jan?.netResult).toBe('6000.00');

    expect(feb?.revenue).toBe('15000.00');
    expect(feb?.expenses).toBe('0.00');
    expect(feb?.netResult).toBe('15000.00');

    expect(evo.totals.revenue).toBe('25000.00');
    expect(evo.totals.expenses).toBe('4000.00');
    expect(evo.totals.netResult).toBe('21000.00');
  });
});

describe('DashboardAnalyticsService.getTopAccounts', () => {
  it('returns top expenses sorted by net debit desc with share %', async () => {
    const { service } = buildService({
      topFlowRows: [
        {
          accountId: 'a1',
          accountCode: '6011',
          accountLabel: 'Achats',
          totalDebit: '3000000',
          totalCredit: '0',
        },
        {
          accountId: 'a2',
          accountCode: '6111',
          accountLabel: 'Sous-traitance',
          totalDebit: '1500000',
          totalCredit: '0',
        },
        {
          accountId: 'a3',
          accountCode: '6411',
          accountLabel: 'Salaires',
          totalDebit: '500000',
          totalCredit: '0',
        },
      ],
    });

    const result = await service.getTopAccounts(ORG_ID, {
      exerciseId: EXERCISE_ID,
      category: 'expenses',
      limit: 2,
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.accountCode).toBe('6011');
    expect(result.rows[0]?.amount).toBe('3000000.00');
    expect(result.rows[0]?.sharePercent).toBe(60); // 3M / 5M total
    expect(result.rows[1]?.accountCode).toBe('6111');
    expect(result.rows[1]?.sharePercent).toBe(30);

    expect(result.totalAmount).toBe('5000000.00');
    expect(result.category).toBe('expenses');
  });

  it('inverts sign for revenue: tri par crédit desc', async () => {
    const { service } = buildService({
      topFlowRows: [
        {
          accountId: 'r1',
          accountCode: '7011',
          accountLabel: 'Ventes marchandises',
          totalDebit: '0',
          totalCredit: '8000000',
        },
        {
          accountId: 'r2',
          accountCode: '7061',
          accountLabel: 'Services rendus',
          totalDebit: '500000',
          totalCredit: '2500000',
        },
      ],
    });
    const result = await service.getTopAccounts(ORG_ID, {
      exerciseId: EXERCISE_ID,
      category: 'revenue',
    });

    expect(result.rows[0]?.accountCode).toBe('7011');
    expect(result.rows[0]?.amount).toBe('8000000.00');
    // r2 net = 2_500_000 - 500_000 = 2_000_000
    expect(result.rows[1]?.amount).toBe('2000000.00');
  });

  it('excludes accounts whose net is ≤ 0 (contra-entries cleared)', async () => {
    const { service } = buildService({
      topFlowRows: [
        {
          accountId: 'a1',
          accountCode: '6011',
          accountLabel: 'Achats',
          totalDebit: '1000',
          totalCredit: '0',
        },
        // Contre-passé : débit == crédit → net 0, exclu
        {
          accountId: 'a2',
          accountCode: '6012',
          accountLabel: 'Contre-passé',
          totalDebit: '500',
          totalCredit: '500',
        },
        // Net négatif (avoir > facture) — exclu de la catégorie expenses
        {
          accountId: 'a3',
          accountCode: '6013',
          accountLabel: 'Avoir net',
          totalDebit: '100',
          totalCredit: '300',
        },
      ],
    });
    const result = await service.getTopAccounts(ORG_ID, {
      exerciseId: EXERCISE_ID,
      category: 'expenses',
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.accountCode).toBe('6011');
  });

  it('caps limit to 50 even if higher is requested', async () => {
    const manyRows: TopAccountFlowRow[] = Array.from({ length: 60 }, (_, i) => ({
      accountId: `a${i}`,
      accountCode: `60${String(i).padStart(2, '0')}`,
      accountLabel: `Account ${i}`,
      totalDebit: '100',
      totalCredit: '0',
    }));
    const { service } = buildService({ topFlowRows: manyRows });
    const result = await service.getTopAccounts(ORG_ID, {
      exerciseId: EXERCISE_ID,
      category: 'expenses',
      limit: 999,
    });
    expect(result.rows.length).toBeLessThanOrEqual(50);
  });

  it('handles zero total without dividing by zero (sharePercent = 0)', async () => {
    const { service } = buildService({ topFlowRows: [] });
    const result = await service.getTopAccounts(ORG_ID, {
      exerciseId: EXERCISE_ID,
      category: 'expenses',
    });
    expect(result.rows).toHaveLength(0);
    expect(result.totalAmount).toBe('0.00');
  });
});
