import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AccountingPeriodEntity } from '../entities/accounting-period.entity';
import { PeriodsService } from '../services/periods.service';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const PERIOD_ID = '00000000-0000-4000-8000-000000000003';
const CHILD_ID = '00000000-0000-4000-8000-000000000004';

const CTX = {
  userId: USER_ID,
  organizationId: ORG_ID,
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

function makePeriod(overrides: Partial<AccountingPeriodEntity> = {}): AccountingPeriodEntity {
  return {
    id: PERIOD_ID,
    organizationId: ORG_ID,
    parentId: null,
    kind: 'MONTHLY',
    label: 'Jan 2026',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    status: 'open',
    closedAt: null,
    closedBy: null,
    reopenedReason: null,
    ...overrides,
  } as AccountingPeriodEntity;
}

function buildService(
  overrides: {
    period?: AccountingPeriodEntity | null;
    draftCount?: number;
    children?: AccountingPeriodEntity[];
    createResult?: AccountingPeriodEntity;
  } = {},
) {
  const period = overrides.period === undefined ? makePeriod() : overrides.period;
  const draftCount = overrides.draftCount ?? 0;
  const children = overrides.children ?? [];

  const annualId = '00000000-0000-4000-8000-000000000010';
  const created: AccountingPeriodEntity =
    overrides.createResult ??
    ({
      id: annualId,
      organizationId: ORG_ID,
      parentId: null,
      kind: 'ANNUAL',
      label: '2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'open',
      closedAt: null,
      closedBy: null,
      reopenedReason: null,
    } as AccountingPeriodEntity);

  const periodsRepo = {
    findById: jest.fn().mockResolvedValue(period),
    listByOrganization: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(created),
    closePeriod: jest.fn().mockResolvedValue(undefined),
    reopenPeriod: jest.fn().mockResolvedValue(undefined),
    listChildren: jest.fn().mockResolvedValue(children),
  };

  const entriesRepo = {
    countDraftsByPeriod: jest.fn().mockResolvedValue(draftCount),
  };

  const audit = { record: jest.fn().mockResolvedValue(null) };

  const service = new PeriodsService(periodsRepo as never, entriesRepo as never, audit as never);

  return { service, periodsRepo, entriesRepo, audit };
}

// ─── createFiscalYear ──────────────────────────────────────────────────────

describe('PeriodsService.createFiscalYear', () => {
  it('MONTHLY: creates 1 ANNUAL + 12 MONTHLY sub-periods (13 saves total)', async () => {
    const { service, periodsRepo, audit } = buildService();

    await service.createFiscalYear(asTenantId(ORG_ID), 2026, 'MONTHLY', USER_ID, CTX);

    expect(periodsRepo.create).toHaveBeenCalledTimes(13); // 1 annual + 12 monthly
    const annualCall = periodsRepo.create.mock.calls[0][0] as Record<string, unknown>;
    expect(annualCall.kind).toBe('ANNUAL');
    expect(annualCall.label).toBe('2026');
    expect(annualCall.startDate).toBe('2026-01-01');
    expect(annualCall.endDate).toBe('2026-12-31');

    // All 12 sub-period calls must have kind MONTHLY and parentId from the annual
    for (let i = 1; i <= 12; i++) {
      const subCall = periodsRepo.create.mock.calls[i][0] as Record<string, unknown>;
      expect(subCall.kind).toBe('MONTHLY');
      expect(subCall.parentId).toBeDefined();
    }

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'journals.period_created' }),
    );
  });

  it('QUARTERLY: creates 1 ANNUAL + 4 QUARTERLY sub-periods (5 saves total)', async () => {
    const { service, periodsRepo } = buildService();

    await service.createFiscalYear(asTenantId(ORG_ID), 2026, 'QUARTERLY', USER_ID, CTX);

    expect(periodsRepo.create).toHaveBeenCalledTimes(5);
    for (let i = 1; i <= 4; i++) {
      const subCall = periodsRepo.create.mock.calls[i][0] as Record<string, unknown>;
      expect(subCall.kind).toBe('QUARTERLY');
    }
  });

  it('ANNUAL_ONLY: creates only 1 ANNUAL period (no sub-periods)', async () => {
    const { service, periodsRepo } = buildService();

    await service.createFiscalYear(asTenantId(ORG_ID), 2026, 'ANNUAL_ONLY', USER_ID, CTX);

    expect(periodsRepo.create).toHaveBeenCalledTimes(1);
    const call = periodsRepo.create.mock.calls[0][0] as Record<string, unknown>;
    expect(call.kind).toBe('ANNUAL');
  });

  it('emits journals.period_created audit with year + split', async () => {
    const { service, audit } = buildService();

    await service.createFiscalYear(asTenantId(ORG_ID), 2026, 'MONTHLY', USER_ID, CTX);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'journals.period_created',
        entityType: 'accounting_period',
        metadata: expect.objectContaining({ year: 2026, split: 'MONTHLY' }),
      }),
    );
  });
});

// ─── closePeriod ───────────────────────────────────────────────────────────

describe('PeriodsService.closePeriod', () => {
  it('happy path: closes an open period with no drafts', async () => {
    const { service, periodsRepo, audit } = buildService({
      period: makePeriod({ status: 'open' }),
      draftCount: 0,
    });

    await service.closePeriod(asTenantId(ORG_ID), PERIOD_ID, USER_ID, CTX);

    expect(periodsRepo.closePeriod).toHaveBeenCalledWith(PERIOD_ID, USER_ID);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'journals.period_closed' }),
    );
  });

  it('rejects with ACCOUNTING_PERIOD_CLOSED if period is already closed', async () => {
    const { service } = buildService({
      period: makePeriod({ status: 'closed' }),
    });

    await expect(
      service.closePeriod(asTenantId(ORG_ID), PERIOD_ID, USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.ACCOUNTING_PERIOD_CLOSED });
  });

  it('rejects with ACCOUNTING_PERIOD_HAS_DRAFTS when draft entries exist', async () => {
    const { service } = buildService({
      period: makePeriod({ status: 'open' }),
      draftCount: 3,
    });

    await expect(
      service.closePeriod(asTenantId(ORG_ID), PERIOD_ID, USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.ACCOUNTING_PERIOD_HAS_DRAFTS });
  });

  it('cascades close to open children when period is ANNUAL', async () => {
    const openChild: AccountingPeriodEntity = makePeriod({
      id: CHILD_ID,
      kind: 'MONTHLY',
      status: 'open',
    });
    const closedChild: AccountingPeriodEntity = makePeriod({
      id: '00000000-0000-4000-8000-000000000099',
      kind: 'MONTHLY',
      status: 'closed',
    });
    const { service, periodsRepo } = buildService({
      period: makePeriod({ kind: 'ANNUAL' }),
      draftCount: 0,
      children: [openChild, closedChild],
    });

    await service.closePeriod(asTenantId(ORG_ID), PERIOD_ID, USER_ID, CTX);

    // Both ANNUAL itself + the open child — but not the already-closed child
    expect(periodsRepo.closePeriod).toHaveBeenCalledTimes(2);
    expect(periodsRepo.closePeriod).toHaveBeenCalledWith(PERIOD_ID, USER_ID);
    expect(periodsRepo.closePeriod).toHaveBeenCalledWith(CHILD_ID, USER_ID);
  });

  it('does not cascade to children when period is MONTHLY', async () => {
    const { service, periodsRepo } = buildService({
      period: makePeriod({ kind: 'MONTHLY' }),
      draftCount: 0,
    });

    await service.closePeriod(asTenantId(ORG_ID), PERIOD_ID, USER_ID, CTX);

    expect(periodsRepo.listChildren).not.toHaveBeenCalled();
    expect(periodsRepo.closePeriod).toHaveBeenCalledTimes(1);
  });

  it('rejects with ACCOUNTING_PERIOD_NOT_FOUND when period does not exist', async () => {
    const { service } = buildService({ period: null });

    await expect(
      service.closePeriod(asTenantId(ORG_ID), PERIOD_ID, USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.ACCOUNTING_PERIOD_NOT_FOUND });
  });
});

// ─── reopenPeriod ──────────────────────────────────────────────────────────

describe('PeriodsService.reopenPeriod', () => {
  it('happy path: reopens a closed period with a valid reason', async () => {
    const { service, periodsRepo, audit } = buildService({
      period: makePeriod({ status: 'closed' }),
    });

    await service.reopenPeriod(
      asTenantId(ORG_ID),
      PERIOD_ID,
      'Correction erreur comptable',
      USER_ID,
      CTX,
    );

    expect(periodsRepo.reopenPeriod).toHaveBeenCalledWith(PERIOD_ID, 'Correction erreur comptable');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'journals.period_reopened' }),
    );
  });

  it('is idempotent when period is already open (no repo call, no audit)', async () => {
    const { service, periodsRepo, audit } = buildService({
      period: makePeriod({ status: 'open' }),
    });

    await service.reopenPeriod(asTenantId(ORG_ID), PERIOD_ID, 'Some reason', USER_ID, CTX);

    expect(periodsRepo.reopenPeriod).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects with ACCOUNTING_PERIOD_REOPEN_REASON_REQUIRED when reason is empty', async () => {
    const { service } = buildService({ period: makePeriod({ status: 'closed' }) });

    await expect(
      service.reopenPeriod(asTenantId(ORG_ID), PERIOD_ID, '', USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.ACCOUNTING_PERIOD_REOPEN_REASON_REQUIRED });
  });

  it('rejects with ACCOUNTING_PERIOD_REOPEN_REASON_REQUIRED when reason is whitespace-only', async () => {
    const { service } = buildService({ period: makePeriod({ status: 'closed' }) });

    await expect(
      service.reopenPeriod(asTenantId(ORG_ID), PERIOD_ID, '   ', USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.ACCOUNTING_PERIOD_REOPEN_REASON_REQUIRED });
  });

  it('rejects with ACCOUNTING_PERIOD_NOT_FOUND when period does not exist', async () => {
    const { service } = buildService({ period: null });

    await expect(
      service.reopenPeriod(asTenantId(ORG_ID), PERIOD_ID, 'valid reason', USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.ACCOUNTING_PERIOD_NOT_FOUND });
  });
});
