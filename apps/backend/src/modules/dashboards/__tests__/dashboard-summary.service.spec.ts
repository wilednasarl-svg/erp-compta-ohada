import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AccountingPeriodEntity } from '../../journals/entities/accounting-period.entity';
import type { ClassNetRow, CodePrefixNetRow } from '../repositories/dashboards.repository';
import { DashboardSummaryService } from '../services/dashboard-summary.service';

/**
 * Unit tests on `DashboardSummaryService`.
 *
 * Approche : injecter des fakes minimaux pour `DashboardsRepository`
 * et `AccountingPeriodRepository` — pas besoin d'une base réelle pour
 * valider la logique d'agrégation et de signe.
 *
 * Le dataset miroir un cas réaliste : exercice 2026, 1 organisation
 * avec activité ventes/achats/trésorerie sur les comptes SYSCOHADA
 * standards.
 */

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

function buildService(opts: {
  classRows?: ClassNetRow[];
  cash?: CodePrefixNetRow;
  ar?: CodePrefixNetRow;
  ap?: CodePrefixNetRow;
  period?: AccountingPeriodEntity | null;
}) {
  const dashRepo = {
    aggregateByClass: jest.fn().mockResolvedValue(opts.classRows ?? []),
    aggregateByCodePrefix: jest.fn().mockImplementation((_org, _to, prefixes: string[]) => {
      if (prefixes.includes('51')) return opts.cash ?? { totalDebit: '0', totalCredit: '0' };
      if (prefixes.includes('41')) return opts.ar ?? { totalDebit: '0', totalCredit: '0' };
      if (prefixes.includes('40')) return opts.ap ?? { totalDebit: '0', totalCredit: '0' };
      return { totalDebit: '0', totalCredit: '0' };
    }),
    unletteredLinesByCodePrefix: jest.fn().mockResolvedValue([]),
  };
  const periodsRepo = {
    findById: jest.fn().mockResolvedValue(opts.period === undefined ? FAKE_PERIOD : opts.period),
  };
  return {
    service: new DashboardSummaryService(dashRepo as never, periodsRepo as never),
    dashRepo,
    periodsRepo,
  };
}

describe('DashboardSummaryService', () => {
  describe('happy path', () => {
    it('aggregates cash, AR, AP, YTD revenue and expenses with correct signs', async () => {
      const { service } = buildService({
        cash: { totalDebit: '5000000.00', totalCredit: '1500000.00' }, // net débit = 3 500 000
        ar: { totalDebit: '8000000.00', totalCredit: '2000000.00' }, // créances = 6 000 000
        ap: { totalDebit: '500000.00', totalCredit: '3000000.00' }, // dettes = 2 500 000
        classRows: [
          { accountClass: 6, totalDebit: '4500000.00', totalCredit: '0.00' }, // charges
          { accountClass: 7, totalDebit: '0.00', totalCredit: '10000000.00' }, // produits
        ],
      });

      const summary = await service.getSummary(ORG_ID, EXERCISE_ID);

      expect(summary.cashBalance).toBe('3500000.00');
      expect(summary.receivables).toBe('6000000.00');
      expect(summary.payables).toBe('2500000.00');
      expect(summary.revenueYtd).toBe('10000000.00');
      expect(summary.expensesYtd).toBe('4500000.00');
      expect(summary.netResultYtd).toBe('5500000.00');
      expect(summary.periodStart).toBe('2026-01-01');
      expect(summary.periodEnd).toBe('2026-12-31');
      expect(summary.currency).toBe('XOF');
    });

    it('computes ratios when denominators are positive', async () => {
      const { service } = buildService({
        cash: { totalDebit: '2000000.00', totalCredit: '0.00' },
        ap: { totalDebit: '0.00', totalCredit: '500000.00' },
        classRows: [
          { accountClass: 6, totalDebit: '3000000.00', totalCredit: '0.00' },
          { accountClass: 7, totalDebit: '0.00', totalCredit: '5000000.00' },
        ],
      });
      const summary = await service.getSummary(ORG_ID, EXERCISE_ID);

      // grossMarginRatio = (5_000_000 - 3_000_000) / 5_000_000 = 0.4
      expect(summary.grossMarginRatio).toBe(0.4);
      // liquidityRatio = 2_000_000 / 500_000 = 4
      expect(summary.liquidityRatio).toBe(4);
    });
  });

  describe('edge cases', () => {
    it('returns null ratios when denominators are zero (no division-by-zero leak)', async () => {
      const { service } = buildService({
        cash: { totalDebit: '500000.00', totalCredit: '0.00' },
        ap: { totalDebit: '0.00', totalCredit: '0.00' }, // pas de fournisseurs
        classRows: [
          { accountClass: 6, totalDebit: '100000.00', totalCredit: '0.00' },
          // pas de classe 7 → revenue = 0
        ],
      });
      const summary = await service.getSummary(ORG_ID, EXERCISE_ID);

      expect(summary.grossMarginRatio).toBeNull();
      expect(summary.liquidityRatio).toBeNull();
      expect(summary.revenueYtd).toBe('0.00');
      expect(summary.expensesYtd).toBe('100000.00');
    });

    it('handles a negative net result (loss-making exercise)', async () => {
      const { service } = buildService({
        classRows: [
          { accountClass: 6, totalDebit: '8000000.00', totalCredit: '0.00' },
          { accountClass: 7, totalDebit: '0.00', totalCredit: '5000000.00' },
        ],
      });
      const summary = await service.getSummary(ORG_ID, EXERCISE_ID);

      expect(summary.netResultYtd).toBe('-3000000.00');
      // grossMarginRatio peut être négative — signale une marge brute négative
      expect(summary.grossMarginRatio).toBe(-0.6);
    });

    it('builds a sorted breakdown by class with humanised labels', async () => {
      const { service } = buildService({
        classRows: [
          { accountClass: 7, totalDebit: '0.00', totalCredit: '1000.00' },
          { accountClass: 6, totalDebit: '500.00', totalCredit: '0.00' },
          { accountClass: 5, totalDebit: '2000.00', totalCredit: '0.00' },
        ],
      });
      const summary = await service.getSummary(ORG_ID, EXERCISE_ID);

      const classes = summary.accountClassBreakdown.map((r) => r.accountClass);
      expect(classes).toEqual([5, 6, 7]); // tri ascendant
      const labels = summary.accountClassBreakdown.map((r) => r.label);
      expect(labels).toEqual(['Trésorerie', 'Charges', 'Produits']);
      // Net classe 7 = credit - debit serait négatif (-1000) ici car
      // on prend debit - credit pour le breakdown brut, et le signe
      // attendu pour les produits est le crédit naturel.
      const class7 = summary.accountClassBreakdown.find((r) => r.accountClass === 7);
      expect(class7?.net).toBe('-1000.00');
    });
  });

  describe('error paths', () => {
    it('throws ACCOUNTING_PERIOD_NOT_FOUND when exercise does not exist', async () => {
      const { service } = buildService({ period: null });
      await expect(service.getSummary(ORG_ID, EXERCISE_ID)).rejects.toMatchObject({
        code: 'ACCOUNTING_PERIOD_NOT_FOUND',
      });
    });

    it('throws when the exerciseId is a sub-period (parentId not null)', async () => {
      const subPeriod = { ...FAKE_PERIOD, parentId: 'parent-uuid' };
      const { service } = buildService({ period: subPeriod as unknown as AccountingPeriodEntity });
      await expect(service.getSummary(ORG_ID, EXERCISE_ID)).rejects.toMatchObject({
        code: 'ACCOUNTING_PERIOD_NOT_FOUND',
      });
    });

    it('passes the exercise window dates to the underlying repo aggregates', async () => {
      const { service, dashRepo } = buildService({
        cash: { totalDebit: '0', totalCredit: '0' },
      });
      await service.getSummary(ORG_ID, EXERCISE_ID);

      expect(dashRepo.aggregateByClass).toHaveBeenCalledWith(
        ORG_ID,
        '2026-01-01',
        '2026-12-31',
        [1, 2, 3, 4, 5, 6, 7, 8, 9],
      );
      // Soldes instantanés appelés avec le `toDate` de l'exercice
      expect(dashRepo.aggregateByCodePrefix).toHaveBeenCalledWith(ORG_ID, '2026-12-31', [
        '51',
        '53',
        '57',
      ]);
    });
  });
});
