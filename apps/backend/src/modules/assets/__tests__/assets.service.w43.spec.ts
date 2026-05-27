import type { DataSource, EntityManager } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext, AuditTrailService } from '../../audit/services/audit-trail.service';
import type { OrganizationAccountRepository } from '../../accounting-plan/repositories/organization-account.repository';
import type { EntriesService } from '../../journals/services/entries.service';
import type { AssetEntity } from '../entities/asset.entity';
import type { DepreciationScheduleEntity } from '../entities/depreciation-schedule.entity';
import type { AssetsRepository } from '../repositories/assets.repository';
import type { DepreciationSchedulesRepository } from '../repositories/depreciation-schedules.repository';
import type { CreateAssetDto } from '../dto/create-asset.dto';
import { AssetsService } from '../services/assets.service';

const ORG_ID = asTenantId('org-1');
const ACTOR_ID = 'user-actor';
const CTX: AuditContext = { ipAddress: '203.0.113.1', userAgent: 'jest/1.0' };

const ACCOUNT_TABLE: Record<string, string> = {
  '244': 'acc-244',
  '2844': 'acc-2844',
  '6813': 'acc-6813',
  '851': 'acc-851',
  '151': 'acc-151',
  '861': 'acc-861',
};
const ID_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(ACCOUNT_TABLE).map(([code, id]) => [id, code]),
);

function buildBaseDto(overrides: Partial<CreateAssetDto> = {}): CreateAssetDto {
  return {
    code: 'IMM-001',
    label: 'Bien test',
    acquisitionDate: '2026-01-01',
    putInServiceDate: '2026-01-01',
    acquisitionCost: '100000.00',
    residualValue: '0.00',
    depreciationMethod: 'linear',
    durationMonths: 60,
    assetAccountCode: '244',
    depreciationAccountCode: '2844',
    expenseAccountCode: '6813',
    ...overrides,
  } as CreateAssetDto;
}

interface Harness {
  service: AssetsService;
  assetsCreate: jest.Mock;
  assetsFindByCode: jest.Mock;
  schedulesCreateMany: jest.Mock;
  schedulesFindById: jest.Mock;
  schedulesUpdate: jest.Mock;
  assetsFindById: jest.Mock;
  accountsFindById: jest.Mock;
  accountsFindByCode: jest.Mock;
  createDraft: jest.Mock;
  validateEntry: jest.Mock;
}

function buildHarness(): Harness {
  const assetsCreate = jest.fn(async (input) => ({
    id: 'asset-new',
    organizationId: input.organizationId,
    code: input.code,
    label: input.label,
    acquisitionDate: input.acquisitionDate,
    putInServiceDate: input.putInServiceDate,
    acquisitionCost: input.acquisitionCost,
    residualValue: input.residualValue ?? '0.00',
    depreciationMethod: input.depreciationMethod,
    durationMonths: input.durationMonths,
    decliningRate: input.decliningRate ?? null,
    assetAccountId: input.assetAccountId,
    depreciationAccountId: input.depreciationAccountId,
    expenseAccountId: input.expenseAccountId,
    status: 'active',
    disposalDate: null,
    disposalValue: null,
    createdById: input.createdById,
    totalUnits: input.totalUnits ?? null,
    unitsPerYear: input.unitsPerYear ?? null,
    derogatoryEnabled: input.derogatoryEnabled ?? false,
    derogatoryFiscalMethod: input.derogatoryFiscalMethod ?? null,
    derogatoryFiscalDuration: input.derogatoryFiscalDuration ?? null,
    derogatoryFiscalDecliningRate: input.derogatoryFiscalDecliningRate ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })) as unknown as jest.Mock;
  const assetsFindByCode = jest.fn().mockResolvedValue(null);
  const assetsFindById = jest.fn();
  const assetsRepoMock = {
    findById: assetsFindById,
    findByCode: assetsFindByCode,
    create: assetsCreate,
    update: jest.fn(),
    listByOrganization: jest.fn(),
    delete: jest.fn(),
  } as unknown as AssetsRepository;

  const schedulesCreateMany = jest.fn(async (rows) =>
    rows.map((r: object, i: number) => ({ id: `sched-${i}`, ...r })),
  );
  const schedulesFindById = jest.fn();
  const schedulesUpdate = jest.fn(async (id, _org, patch) => ({ id, ...patch }));
  const schedulesRepoMock = {
    createMany: schedulesCreateMany,
    deletePendingByAsset: jest.fn(),
    listByAsset: jest.fn(),
    findById: schedulesFindById,
    update: schedulesUpdate,
  } as unknown as DepreciationSchedulesRepository;

  const accountsFindById = jest.fn(async (id: string) => {
    const code = ID_TO_CODE[id];
    return code ? { id, code } : null;
  });
  const accountsFindByCode = jest.fn(async (code: string) => {
    const id = ACCOUNT_TABLE[code];
    return id ? { id, code } : null;
  });
  const accountsRepoMock = {
    findById: accountsFindById,
    findByCode: accountsFindByCode,
  } as unknown as OrganizationAccountRepository;

  let counter = 0;
  const createDraft = jest.fn(async () => ({ id: `je-${++counter}` }));
  const validateEntry = jest.fn().mockResolvedValue(undefined);
  const entriesServiceMock = {
    createDraft,
    validate: validateEntry,
  } as unknown as EntriesService;

  const auditMock = { record: jest.fn().mockResolvedValue(null) } as unknown as AuditTrailService;

  const dataSource = {
    transaction: <T>(fn: (m: EntityManager) => Promise<T>) => fn({} as EntityManager),
  } as unknown as DataSource;

  const service = new AssetsService(
    dataSource,
    assetsRepoMock,
    schedulesRepoMock,
    accountsRepoMock,
    entriesServiceMock,
    auditMock,
  );

  return {
    service,
    assetsCreate,
    assetsFindByCode,
    schedulesCreateMany,
    schedulesFindById,
    schedulesUpdate,
    assetsFindById,
    accountsFindById,
    accountsFindByCode,
    createDraft,
    validateEntry,
  };
}

describe('AssetsService — W4.3 SOFTY + UOP + dérogatoires', () => {
  describe('create() — SOFTY', () => {
    it('persist a SOFTY schedule (5 lines, descending annuities)', async () => {
      const h = buildHarness();
      const dto = buildBaseDto({ depreciationMethod: 'softy' });
      const result = await h.service.create(ORG_ID, dto, ACTOR_ID, CTX);

      expect(result.schedule).toHaveLength(5);
      const amounts = result.schedule.map((s) => Number(s.depreciationAmount));
      expect(amounts[0]).toBeCloseTo(33333.33, 1);
      expect(amounts[4]).toBeCloseTo(6666.67, 1);
      // descending
      for (let i = 1; i < amounts.length; i++) {
        expect(amounts[i]).toBeLessThan(amounts[i - 1]);
      }
    });
  });

  describe('create() — UOP', () => {
    it('persist a UOP schedule following unitsPerYear', async () => {
      const h = buildHarness();
      const dto = buildBaseDto({
        depreciationMethod: 'units_of_production',
        durationMonths: 48,
        totalUnits: 10000,
        unitsPerYear: [3000, 2500, 2500, 2000],
      });
      const result = await h.service.create(ORG_ID, dto, ACTOR_ID, CTX);
      expect(result.schedule).toHaveLength(4);
      const amounts = result.schedule.map((s) => Number(s.depreciationAmount));
      expect(amounts).toEqual([30000, 25000, 25000, 20000]);
    });

    it('rejects UOP without totalUnits + unitsPerYear → ASSET_UOP_UNITS_REQUIRED', async () => {
      const h = buildHarness();
      const dto = buildBaseDto({ depreciationMethod: 'units_of_production' });
      await expect(h.service.create(ORG_ID, dto, ACTOR_ID, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.ASSET_UOP_UNITS_REQUIRED,
      });
    });

    it('rejects UOP overflow → ASSET_UOP_UNITS_OVERFLOW', async () => {
      const h = buildHarness();
      const dto = buildBaseDto({
        depreciationMethod: 'units_of_production',
        durationMonths: 36,
        totalUnits: 5000,
        unitsPerYear: [3000, 3000, 2000],
      });
      await expect(h.service.create(ORG_ID, dto, ACTOR_ID, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.ASSET_UOP_UNITS_OVERFLOW,
      });
    });
  });

  describe('create() — dérogatoire', () => {
    it('persist schedule with derogatory dotation columns populated', async () => {
      const h = buildHarness();
      const dto = buildBaseDto({
        depreciationMethod: 'linear',
        derogatory: {
          enabled: true,
          fiscalMethod: 'declining',
          economicMethod: 'linear',
          fiscalDecliningRate: '0.4',
        },
      });
      const result = await h.service.create(ORG_ID, dto, ACTOR_ID, CTX);
      // Année 1 : fiscal 40k - éco 20k = 20k dotation.
      const firstRow = result.schedule[0] as DepreciationScheduleEntity & {
        derogatoryDotation: string | null;
      };
      expect(firstRow.derogatoryDotation).not.toBeNull();
      expect(Number(firstRow.derogatoryDotation)).toBeGreaterThan(15000);
    });

    it('rejects derogatory.enabled without fiscalMethod → ASSET_DEROGATORY_CONFIG_INVALID', async () => {
      const h = buildHarness();
      const dto = buildBaseDto({
        derogatory: { enabled: true } as never,
      });
      await expect(h.service.create(ORG_ID, dto, ACTOR_ID, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.ASSET_DEROGATORY_CONFIG_INVALID,
      });
    });
  });

  describe('postDepreciation() — multi-line dérogatoire', () => {
    it('emits expense + derogatory dotation lines (D 681 + D 851 / C 28x + C 151)', async () => {
      const h = buildHarness();
      // Build an asset + a schedule with derogatory dotation > 0.
      const asset = {
        id: 'asset-1',
        organizationId: ORG_ID,
        code: 'IMM-D',
        label: 'Avec dérog',
        acquisitionDate: '2026-01-01',
        putInServiceDate: '2026-01-01',
        acquisitionCost: '100000.00',
        residualValue: '0.00',
        depreciationMethod: 'linear',
        durationMonths: 60,
        decliningRate: null,
        assetAccountId: ACCOUNT_TABLE['244'],
        depreciationAccountId: ACCOUNT_TABLE['2844'],
        expenseAccountId: ACCOUNT_TABLE['6813'],
        status: 'active',
        disposalDate: null,
        disposalValue: null,
        createdById: ACTOR_ID,
        totalUnits: null,
        unitsPerYear: null,
        derogatoryEnabled: true,
        derogatoryFiscalMethod: 'declining',
        derogatoryFiscalDuration: null,
        derogatoryFiscalDecliningRate: '0.4',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as AssetEntity;

      h.assetsFindById.mockResolvedValue(asset);
      h.schedulesFindById.mockResolvedValue({
        id: 'sched-d-1',
        organizationId: ORG_ID,
        assetId: 'asset-1',
        fiscalYear: 2026,
        periodStart: '2026-01-01',
        periodEnd: '2026-12-31',
        depreciationAmount: '20000.00',
        cumulativeDepreciation: '20000.00',
        netBookValue: '80000.00',
        status: 'pending',
        journalEntryId: null,
        postedAt: null,
        postedById: null,
        economicAmount: '20000.00',
        fiscalAmount: '40000.00',
        derogatoryDotation: '20000.00',
        derogatoryReprise: '0.00',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as DepreciationScheduleEntity);

      await h.service.postDepreciation('sched-d-1', ORG_ID, ACTOR_ID, CTX);

      // The createDraft must have been called with 4 lines (2 amort + 2 derog).
      expect(h.createDraft).toHaveBeenCalledTimes(1);
      const callArgs = h.createDraft.mock.calls[0][1];
      expect(callArgs.lines).toHaveLength(4);
      const accountCodes = callArgs.lines.map((l: { accountCode: string }) => l.accountCode);
      expect(accountCodes).toContain('6813');
      expect(accountCodes).toContain('2844');
      expect(accountCodes).toContain('851');
      expect(accountCodes).toContain('151');
    });

    it('emits reprise lines (D 151 / C 861) when derogatoryReprise > 0', async () => {
      const h = buildHarness();
      const asset = {
        id: 'asset-2',
        organizationId: ORG_ID,
        code: 'IMM-R',
        label: 'Reprise',
        acquisitionDate: '2026-01-01',
        putInServiceDate: '2026-01-01',
        acquisitionCost: '100000.00',
        residualValue: '0.00',
        depreciationMethod: 'linear',
        durationMonths: 60,
        decliningRate: null,
        assetAccountId: ACCOUNT_TABLE['244'],
        depreciationAccountId: ACCOUNT_TABLE['2844'],
        expenseAccountId: ACCOUNT_TABLE['6813'],
        status: 'active',
        disposalDate: null,
        disposalValue: null,
        createdById: ACTOR_ID,
        totalUnits: null,
        unitsPerYear: null,
        derogatoryEnabled: true,
        derogatoryFiscalMethod: 'declining',
        derogatoryFiscalDuration: null,
        derogatoryFiscalDecliningRate: '0.4',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as AssetEntity;

      h.assetsFindById.mockResolvedValue(asset);
      h.schedulesFindById.mockResolvedValue({
        id: 'sched-r-1',
        organizationId: ORG_ID,
        assetId: 'asset-2',
        fiscalYear: 2030,
        periodStart: '2030-01-01',
        periodEnd: '2030-12-31',
        depreciationAmount: '20000.00',
        cumulativeDepreciation: '100000.00',
        netBookValue: '0.00',
        status: 'pending',
        journalEntryId: null,
        postedAt: null,
        postedById: null,
        economicAmount: '20000.00',
        fiscalAmount: '5000.00',
        derogatoryDotation: '0.00',
        derogatoryReprise: '15000.00',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as DepreciationScheduleEntity);

      await h.service.postDepreciation('sched-r-1', ORG_ID, ACTOR_ID, CTX);

      const callArgs = h.createDraft.mock.calls[0][1];
      const accountCodes = callArgs.lines.map((l: { accountCode: string }) => l.accountCode);
      expect(accountCodes).toContain('151');
      expect(accountCodes).toContain('861');
    });
  });
});

// Sanity export for re-exports / lints (unused import warning safety).
void AppException;
