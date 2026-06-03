import { asTenantId } from '../../../common/persistence/tenant-scope';
import { AppException } from '../../../common/errors/app-exception';
import type { AuditTrailService, AuditContext } from '../../audit/services/audit-trail.service';
import type { AccountingPeriodEntity } from '../entities/accounting-period.entity';
import type { AccountingPeriodRepository } from '../repositories/accounting-period.repository';
import type { JournalEntryRepository } from '../repositories/journal-entry.repository';
import { PeriodsService } from './periods.service';

const ORG = asTenantId('11111111-1111-1111-1111-111111111111');
const CTX = { ipAddress: null, userAgent: null } as unknown as AuditContext;

function annual(
  year: number,
  status: 'open' | 'closed' = 'open',
  id = `y-${year}`,
): AccountingPeriodEntity {
  return {
    id,
    organizationId: ORG,
    parentId: null,
    kind: 'ANNUAL',
    label: String(year),
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    status,
  } as unknown as AccountingPeriodEntity;
}

function setup(opts?: { roots?: AccountingPeriodEntity[]; all?: AccountingPeriodEntity[] }) {
  const periodsRepo = {
    listAnnualRoots: jest.fn(async () => opts?.roots ?? []),
    listByOrganization: jest.fn(async () => opts?.all ?? opts?.roots ?? []),
  };
  const entriesRepo = {} as unknown as JournalEntryRepository;
  const audit = { record: jest.fn() } as unknown as AuditTrailService;
  const service = new PeriodsService(
    periodsRepo as unknown as AccountingPeriodRepository,
    entriesRepo,
    audit,
  );
  return { service, periodsRepo };
}

describe('PeriodsService.analyzeCoverage', () => {
  it('flags a fully missing year', async () => {
    const { service } = setup();

    const cov = await service.analyzeCoverage(ORG, '2025-01-01', '2025-12-31');

    expect(cov.missingYears).toEqual([2025]);
    expect(cov.years).toEqual([{ year: 2025, present: false }]);
    expect(cov.hasGaps).toBe(true);
  });

  it('reports no gap when the year is already covered', async () => {
    const { service } = setup({ roots: [annual(2025)] });

    const cov = await service.analyzeCoverage(ORG, '2025-03-01', '2025-09-30');

    expect(cov.missingYears).toEqual([]);
    expect(cov.closedConflicts).toEqual([]);
    expect(cov.hasGaps).toBe(false);
  });

  it('detects only the missing year across a multi-year range', async () => {
    const { service } = setup({ roots: [annual(2025)] });

    const cov = await service.analyzeCoverage(ORG, '2024-06-01', '2025-06-30');

    expect(cov.missingYears).toEqual([2024]);
    expect(cov.years).toEqual([
      { year: 2024, present: false },
      { year: 2025, present: true },
    ]);
    expect(cov.hasGaps).toBe(true);
  });

  it('surfaces a closed period overlapping the range as a conflict', async () => {
    const closed = {
      ...annual(2025, 'closed'),
      kind: 'MONTHLY',
      label: 'Janvier 2025',
      startDate: '2025-01-01',
      endDate: '2025-01-31',
    } as unknown as AccountingPeriodEntity;
    const { service } = setup({ roots: [annual(2025)], all: [annual(2025), closed] });

    const cov = await service.analyzeCoverage(ORG, '2025-01-10', '2025-02-10');

    expect(cov.missingYears).toEqual([]);
    expect(cov.closedConflicts).toHaveLength(1);
    expect(cov.closedConflicts[0]).toMatchObject({ label: 'Janvier 2025', kind: 'MONTHLY' });
    expect(cov.hasGaps).toBe(true);
  });

  it('rejects an inverted range', async () => {
    const { service } = setup();
    await expect(service.analyzeCoverage(ORG, '2025-12-31', '2025-01-01')).rejects.toBeInstanceOf(
      AppException,
    );
  });
});

describe('PeriodsService.ensureFiscalYearsForRange', () => {
  it('creates every missing fiscal year of the range with the requested split', async () => {
    const { service } = setup();
    const spy = jest
      .spyOn(service, 'createFiscalYear')
      .mockImplementation(async (_org, year) => annual(year));

    const result = await service.ensureFiscalYearsForRange(
      ORG,
      '2024-04-01',
      '2025-03-31',
      'MONTHLY',
      'user-1',
      CTX,
    );

    expect(result.createdYears).toEqual([2024, 2025]);
    expect(result.existingYears).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(ORG, 2024, 'MONTHLY', 'user-1', CTX);
  });

  it('skips a year already covered and creates only the missing one (idempotent)', async () => {
    const { service } = setup({ roots: [annual(2025)] });
    const spy = jest
      .spyOn(service, 'createFiscalYear')
      .mockImplementation(async (_org, year) => annual(year));

    const result = await service.ensureFiscalYearsForRange(
      ORG,
      '2024-06-01',
      '2025-06-30',
      'MONTHLY',
      'user-1',
      CTX,
    );

    expect(result.createdYears).toEqual([2024]);
    expect(result.existingYears).toEqual([2025]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(ORG, 2024, 'MONTHLY', 'user-1', CTX);
  });

  it('does nothing when the whole range is already covered', async () => {
    const { service } = setup({ roots: [annual(2024), annual(2025)] });
    const spy = jest.spyOn(service, 'createFiscalYear');

    const result = await service.ensureFiscalYearsForRange(
      ORG,
      '2024-01-01',
      '2025-12-31',
      'MONTHLY',
      'user-1',
      CTX,
    );

    expect(result.createdYears).toEqual([]);
    expect(result.existingYears).toEqual([2024, 2025]);
    expect(spy).not.toHaveBeenCalled();
  });
});
