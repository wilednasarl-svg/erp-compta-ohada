import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AccountingPeriodEntity } from '../../journals/entities/accounting-period.entity';
import type { AgingLineRow } from '../repositories/dashboards.repository';
import { DashboardAgingService, pickBucket } from '../services/dashboard-aging.service';

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

function line(p: {
  accountId?: string;
  code?: string;
  label?: string;
  netSigned: string;
  daysOld: number;
}): AgingLineRow {
  return {
    accountId: p.accountId ?? '00000000-0000-4000-8000-AAAAAAAAAAAA',
    accountCode: p.code ?? '4111CLI-A',
    accountLabel: p.label ?? 'Client A',
    netSigned: p.netSigned,
    daysOld: p.daysOld,
  };
}

function buildService(opts: {
  lines?: AgingLineRow[];
  period?: AccountingPeriodEntity | null;
}) {
  const dashRepo = {
    aggregateByClass: jest.fn(),
    aggregateByCodePrefix: jest.fn(),
    unletteredLinesByCodePrefix: jest.fn().mockResolvedValue(opts.lines ?? []),
  };
  const periodsRepo = {
    findById: jest.fn().mockResolvedValue(opts.period === undefined ? FAKE_PERIOD : opts.period),
  };
  return {
    service: new DashboardAgingService(dashRepo as never, periodsRepo as never),
    dashRepo,
    periodsRepo,
  };
}

describe('pickBucket', () => {
  it.each([
    [0, '0-30'],
    [15, '0-30'],
    [30, '0-30'],
    [31, '31-60'],
    [60, '31-60'],
    [61, '61-90'],
    [90, '61-90'],
    [91, 'over-90'],
    [365, 'over-90'],
    [-5, '0-30'], // ligne future = préventif
  ])('days=%i → %s', (days, expected) => {
    expect(pickBucket(days)).toBe(expected);
  });
});

describe('DashboardAgingService', () => {
  describe('clients', () => {
    it('buckets unlettered receivable lines and aggregates per partner', async () => {
      // 2 clients : A (créances 1.5M sur 2 buckets) et B (300k 0-30).
      const { service } = buildService({
        lines: [
          line({ accountId: 'A', code: '4111CLI-A', label: 'Client A', netSigned: '500000.00', daysOld: 10 }),
          line({ accountId: 'A', code: '4111CLI-A', label: 'Client A', netSigned: '1000000.00', daysOld: 65 }),
          line({ accountId: 'B', code: '4111CLI-B', label: 'Client B', netSigned: '300000.00', daysOld: 5 }),
        ],
      });
      const result = await service.getAging(ORG_ID, { exerciseId: EXERCISE_ID, type: 'clients' });

      expect(result.type).toBe('clients');
      expect(result.asOfDate).toBe('2026-12-31'); // défaut = endDate
      expect(result.totalOutstanding).toBe('1800000.00');

      // Partner A en tête (plus gros total).
      const partnerA = result.partnerBreakdown[0];
      expect(partnerA?.accountId).toBe('A');
      expect(partnerA?.totalOutstanding).toBe('1500000.00');
      expect(partnerA?.amountsByBucket['0-30']).toBe('500000.00');
      expect(partnerA?.amountsByBucket['61-90']).toBe('1000000.00');
      expect(partnerA?.amountsByBucket['over-90']).toBe('0.00');

      const partnerB = result.partnerBreakdown[1];
      expect(partnerB?.accountId).toBe('B');
      expect(partnerB?.amountsByBucket['0-30']).toBe('300000.00');

      // Buckets globaux
      const bucket030 = result.buckets.find((b) => b.bucket === '0-30');
      const bucket6190 = result.buckets.find((b) => b.bucket === '61-90');
      expect(bucket030?.amount).toBe('800000.00'); // 500k + 300k
      expect(bucket030?.lineCount).toBe(2);
      expect(bucket6190?.amount).toBe('1000000.00');
      expect(bucket6190?.lineCount).toBe(1);
    });

    it('excludes partners whose net is non-positive (advance / overpay)', async () => {
      const { service } = buildService({
        lines: [
          line({ accountId: 'A', netSigned: '500000.00', daysOld: 10 }),
          line({ accountId: 'B', netSigned: '-200000.00', daysOld: 20 }), // avance reçue
        ],
      });
      const result = await service.getAging(ORG_ID, { exerciseId: EXERCISE_ID, type: 'clients' });

      expect(result.partnerBreakdown.map((p) => p.accountId)).toEqual(['A']);
      expect(result.totalOutstanding).toBe('500000.00');
    });
  });

  describe('fournisseurs', () => {
    it('inverts sign: a credit-net 40x line becomes a positive dette', async () => {
      // Côté fournisseur on a des crédits = dettes. Le repo renvoie
      // netSigned = debit - credit ; pour une facture fournisseur
      // c'est négatif. Le service inverse pour exposer une dette
      // positive.
      const { service } = buildService({
        lines: [
          line({ accountId: 'X', code: '4011FOU-X', label: 'Fournisseur X', netSigned: '-1200000.00', daysOld: 45 }),
        ],
      });
      const result = await service.getAging(ORG_ID, { exerciseId: EXERCISE_ID, type: 'fournisseurs' });

      expect(result.type).toBe('fournisseurs');
      expect(result.totalOutstanding).toBe('1200000.00');
      expect(result.partnerBreakdown[0]?.amountsByBucket['31-60']).toBe('1200000.00');
    });
  });

  describe('asOfDate', () => {
    it('uses the provided asOfDate instead of the exercise endDate', async () => {
      const { service, dashRepo } = buildService({ lines: [] });
      const customAsOf = '2026-06-30';
      await service.getAging(ORG_ID, {
        exerciseId: EXERCISE_ID,
        type: 'clients',
        asOfDate: customAsOf,
      });
      expect(dashRepo.unletteredLinesByCodePrefix).toHaveBeenCalledWith(
        ORG_ID,
        '2026-01-01',
        '2026-12-31',
        customAsOf,
        '41',
      );
    });
  });

  describe('boundary buckets', () => {
    it('a 90-day line goes to 61-90, a 91-day line goes to over-90', async () => {
      const { service } = buildService({
        lines: [
          line({ accountId: 'A', netSigned: '100.00', daysOld: 90 }),
          line({ accountId: 'B', netSigned: '200.00', daysOld: 91 }),
        ],
      });
      const result = await service.getAging(ORG_ID, { exerciseId: EXERCISE_ID, type: 'clients' });

      const partnerA = result.partnerBreakdown.find((p) => p.accountId === 'A');
      const partnerB = result.partnerBreakdown.find((p) => p.accountId === 'B');
      expect(partnerA?.amountsByBucket['61-90']).toBe('100.00');
      expect(partnerA?.amountsByBucket['over-90']).toBe('0.00');
      expect(partnerB?.amountsByBucket['61-90']).toBe('0.00');
      expect(partnerB?.amountsByBucket['over-90']).toBe('200.00');
    });
  });

  describe('error paths', () => {
    it('throws ACCOUNTING_PERIOD_NOT_FOUND when exercise does not exist', async () => {
      const { service } = buildService({ period: null });
      await expect(
        service.getAging(ORG_ID, { exerciseId: EXERCISE_ID, type: 'clients' }),
      ).rejects.toMatchObject({ code: 'ACCOUNTING_PERIOD_NOT_FOUND' });
    });

    it('refuses sub-periods (parentId not null)', async () => {
      const sub = { ...FAKE_PERIOD, parentId: 'p-uuid' };
      const { service } = buildService({ period: sub as unknown as AccountingPeriodEntity });
      await expect(
        service.getAging(ORG_ID, { exerciseId: EXERCISE_ID, type: 'fournisseurs' }),
      ).rejects.toMatchObject({ code: 'ACCOUNTING_PERIOD_NOT_FOUND' });
    });
  });
});
