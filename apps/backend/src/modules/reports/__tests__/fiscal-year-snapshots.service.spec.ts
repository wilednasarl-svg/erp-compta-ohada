import { NotFoundException } from '@nestjs/common';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AccountingPeriodEntity } from '../../journals/entities/accounting-period.entity';
import type { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import type { FiscalYearSnapshotEntity } from '../entities/fiscal-year-snapshot.entity';
import type { FiscalYearSnapshotsRepository } from '../repositories/fiscal-year-snapshots.repository';
import { FiscalYearSnapshotsService } from '../services/fiscal-year-snapshots.service';
import type { ReportsService } from '../services/reports.service';
import type { CashFlowService } from '../services/cash-flow.service';

const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
const EXERCISE_ID = '11111111-2222-4333-8444-555555555555';

function annualPeriod(
  overrides: Partial<AccountingPeriodEntity> = {},
): AccountingPeriodEntity {
  return {
    id: EXERCISE_ID,
    organizationId: ORG_ID,
    parentId: null,
    kind: 'ANNUAL',
    label: 'Exercice 2026',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    status: 'closed',
    closedAt: new Date(),
    closedBy: null,
    reopenedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AccountingPeriodEntity;
}

function buildHarness(overrides: {
  period?: AccountingPeriodEntity | null;
  existingActive?: FiscalYearSnapshotEntity | null;
} = {}) {
  const period = overrides.period === undefined ? annualPeriod() : overrides.period;
  const existingActive = overrides.existingActive ?? null;

  const reports = {
    getBalanceSheet: jest.fn().mockResolvedValue({ asAtDate: '2026-12-31', total: '1000' }),
    getProfitLoss: jest.fn().mockResolvedValue({ fromDate: '2026-01-01', toDate: '2026-12-31' }),
    getSig: jest.fn().mockResolvedValue({ fromDate: '2026-01-01', toDate: '2026-12-31' }),
  };
  const cashFlow = {
    getCashFlow: jest
      .fn()
      .mockResolvedValue({ fromDate: '2026-01-01', toDate: '2026-12-31' }),
  };
  const periodRepo = {
    findById: jest.fn().mockResolvedValue(period),
  };
  const snapshotsRepo = {
    getActive: jest.fn().mockResolvedValue(existingActive),
    listHistory: jest.fn().mockResolvedValue([]),
    upsertActive: jest.fn().mockImplementation(async (input) => ({
      id: 'new-snapshot-id',
      organizationId: input.organizationId,
      exerciseId: input.exerciseId,
      snapshotType: input.snapshotType,
      payload: input.payload,
      takenAt: new Date(),
      takenById: input.takenById,
      supersededAt: null,
    })),
  };

  const service = new FiscalYearSnapshotsService(
    reports as unknown as ReportsService,
    periodRepo as unknown as AccountingPeriodRepository,
    snapshotsRepo as unknown as FiscalYearSnapshotsRepository,
    cashFlow as unknown as CashFlowService,
  );

  return { service, reports, periodRepo, snapshotsRepo, cashFlow };
}

describe('FiscalYearSnapshotsService.takeSnapshot — guards', () => {
  it('throws NotFoundException when the period does not exist', async () => {
    const h = buildHarness({ period: null });
    await expect(
      h.service.takeSnapshot(ORG_ID, EXERCISE_ID, 'BILAN', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when the period is not annual', async () => {
    const h = buildHarness({ period: annualPeriod({ kind: 'MONTHLY' }) });
    await expect(
      h.service.takeSnapshot(ORG_ID, EXERCISE_ID, 'BILAN', 'user-1'),
    ).rejects.toThrow(/not an annual/);
  });
});

describe('FiscalYearSnapshotsService.takeSnapshot — dispatch per type', () => {
  it('BILAN appelle getBalanceSheet avec fiscalYearStartDate', async () => {
    const h = buildHarness();

    await h.service.takeSnapshot(ORG_ID, EXERCISE_ID, 'BILAN', 'user-1');

    expect(h.reports.getBalanceSheet).toHaveBeenCalledWith(ORG_ID, {
      asAtDate: '2026-12-31',
      fiscalYearStartDate: '2026-01-01',
    });
    expect(h.reports.getProfitLoss).not.toHaveBeenCalled();
    expect(h.reports.getSig).not.toHaveBeenCalled();
    expect(h.cashFlow.getCashFlow).not.toHaveBeenCalled();
  });

  it('PROFIT_LOSS appelle getProfitLoss avec la période', async () => {
    const h = buildHarness();

    await h.service.takeSnapshot(ORG_ID, EXERCISE_ID, 'PROFIT_LOSS', 'user-1');

    expect(h.reports.getProfitLoss).toHaveBeenCalledWith(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
  });

  it('SIG appelle getSig', async () => {
    const h = buildHarness();

    await h.service.takeSnapshot(ORG_ID, EXERCISE_ID, 'SIG', 'user-1');

    expect(h.reports.getSig).toHaveBeenCalledWith(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
  });

  it('TFT appelle cashFlow.getCashFlow (B4 — sur shape CashFlowReport)', async () => {
    const h = buildHarness();

    await h.service.takeSnapshot(ORG_ID, EXERCISE_ID, 'TFT', 'user-1');

    expect(h.cashFlow.getCashFlow).toHaveBeenCalledWith(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
  });
});

describe('FiscalYearSnapshotsService.takeSnapshot — persistance', () => {
  it('délègue upsertActive avec le payload calculé et l\'actorId', async () => {
    const h = buildHarness();

    await h.service.takeSnapshot(ORG_ID, EXERCISE_ID, 'BILAN', 'user-1');

    expect(h.snapshotsRepo.upsertActive).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      exerciseId: EXERCISE_ID,
      snapshotType: 'BILAN',
      payload: expect.objectContaining({ asAtDate: '2026-12-31' }),
      takenById: 'user-1',
    });
  });

  it('supporte un actorId null (snapshot automatique sans utilisateur)', async () => {
    const h = buildHarness();

    await h.service.takeSnapshot(ORG_ID, EXERCISE_ID, 'BILAN', null);

    expect(h.snapshotsRepo.upsertActive).toHaveBeenCalledWith(
      expect.objectContaining({ takenById: null }),
    );
  });
});

describe('FiscalYearSnapshotsService.getActive + listHistory', () => {
  it('getActive renvoie le snapshot actif du repo', async () => {
    const existing = {
      id: 'snap-1',
      organizationId: ORG_ID,
      exerciseId: EXERCISE_ID,
      snapshotType: 'BILAN' as const,
      payload: { foo: 'bar' },
      takenAt: new Date(),
      takenById: 'user-1',
      supersededAt: null,
    } as unknown as FiscalYearSnapshotEntity;
    const h = buildHarness({ existingActive: existing });

    const result = await h.service.getActive(ORG_ID, EXERCISE_ID, 'BILAN');

    expect(result).toBe(existing);
    expect(h.snapshotsRepo.getActive).toHaveBeenCalledWith(ORG_ID, EXERCISE_ID, 'BILAN');
  });

  it('getActive renvoie null si aucun snapshot fixé', async () => {
    const h = buildHarness();

    const result = await h.service.getActive(ORG_ID, EXERCISE_ID, 'TFT');

    expect(result).toBeNull();
  });

  it('listHistory délègue au repo', async () => {
    const h = buildHarness();

    await h.service.listHistory(ORG_ID, EXERCISE_ID, 'SIG');

    expect(h.snapshotsRepo.listHistory).toHaveBeenCalledWith(ORG_ID, EXERCISE_ID, 'SIG');
  });
});
