import type { DataSource, EntityManager } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext, AuditTrailService } from '../../audit/services/audit-trail.service';
import type { OrganizationAccountRepository } from '../../accounting-plan/repositories/organization-account.repository';
import type { AssetEntity } from '../../assets/entities/asset.entity';
import type { DepreciationScheduleEntity } from '../../assets/entities/depreciation-schedule.entity';
import type { AssetsRepository } from '../../assets/repositories/assets.repository';
import type { DepreciationSchedulesRepository } from '../../assets/repositories/depreciation-schedules.repository';
import type { InventoryItemEntity } from '../../inventory/entities/inventory-item.entity';
import type { InventoryItemRepository } from '../../inventory/repositories/inventory-item.repository';
import type { EntriesService } from '../../journals/services/entries.service';
import type { AssetImpairmentEntity } from '../entities/asset-impairment.entity';
import type { InventoryImpairmentEntity } from '../entities/inventory-impairment.entity';
import type {
  AssetImpairmentsRepository,
  CreateAssetImpairmentInput,
} from '../repositories/asset-impairments.repository';
import type {
  CreateInventoryImpairmentInput,
  InventoryImpairmentsRepository,
} from '../repositories/inventory-impairments.repository';
import { ImpairmentsService } from '../services/impairments.service';

const ORG_ID = asTenantId('org-1');
const OTHER_ORG_ID = asTenantId('org-2');
const ACTOR_ID = 'user-actor';
const CTX: AuditContext = { ipAddress: '203.0.113.1', userAgent: 'jest/1.0' };

function buildAsset(overrides: Partial<AssetEntity> = {}): AssetEntity {
  return {
    id: 'asset-1',
    organizationId: ORG_ID,
    code: 'IMM-001',
    label: 'Machine industrielle',
    acquisitionDate: '2024-01-01',
    putInServiceDate: '2024-01-01',
    acquisitionCost: '120000.00',
    residualValue: '0.00',
    depreciationMethod: 'linear',
    durationMonths: 60,
    decliningRate: null,
    assetAccountId: 'acc-241',
    depreciationAccountId: 'acc-2841',
    expenseAccountId: 'acc-6813',
    status: 'active',
    disposalDate: null,
    disposalValue: null,
    createdById: ACTOR_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AssetEntity;
}

function buildSchedule(
  overrides: Partial<DepreciationScheduleEntity> = {},
): DepreciationScheduleEntity {
  return {
    id: 'sched-1',
    organizationId: ORG_ID,
    assetId: 'asset-1',
    fiscalYear: 2024,
    periodStart: '2024-01-01',
    periodEnd: '2024-12-31',
    depreciationAmount: '20000.00',
    cumulativeDepreciation: '20000.00',
    netBookValue: '100000.00',
    status: 'posted',
    journalEntryId: 'je-1',
    postedAt: new Date(),
    postedById: ACTOR_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as DepreciationScheduleEntity;
}

function buildInventoryItem(overrides: Partial<InventoryItemEntity> = {}): InventoryItemEntity {
  return {
    id: 'item-1',
    organizationId: ORG_ID,
    code: 'STK-001',
    label: 'Article test',
    unitOfMeasure: 'unit',
    family: 'marchandises',
    stockAccountId: 'acc-311',
    purchaseAccountId: 'acc-601',
    saleAccountId: 'acc-701',
    currentQty: '100.0000',
    currentCmp: '50.0000',
    status: 'active',
    createdById: ACTOR_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as InventoryItemEntity;
}

interface Harness {
  service: ImpairmentsService;
  assetImpRepo: {
    create: jest.Mock;
    listByOrganization: jest.Mock;
    sumNetImpairmentsForAsset: jest.Mock;
  };
  invImpRepo: {
    create: jest.Mock;
    listByOrganization: jest.Mock;
    sumNetImpairmentsForItem: jest.Mock;
  };
  assetsRepoFindById: jest.Mock;
  schedulesListByAsset: jest.Mock;
  inventoryFindById: jest.Mock;
  accountsFindById: jest.Mock;
  createDraft: jest.Mock;
  validateEntry: jest.Mock;
  recordAudit: jest.Mock;
}

function buildHarness(): Harness {
  // Repos d'impairments — instances "live" capturant les inputs.
  const assetImpRecords: AssetImpairmentEntity[] = [];
  const invImpRecords: InventoryImpairmentEntity[] = [];

  const assetImpCreate = jest.fn(async (input: CreateAssetImpairmentInput) => {
    const row: AssetImpairmentEntity = {
      id: `aimp-${assetImpRecords.length + 1}`,
      organizationId: input.organizationId as string,
      assetId: input.assetId,
      testDate: input.testDate,
      carryingAmount: input.carryingAmount,
      recoverableAmount: input.recoverableAmount,
      impairmentAmount: input.impairmentAmount,
      type: input.type,
      journalEntryId: input.journalEntryId ?? null,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
      createdAt: new Date(),
    } as AssetImpairmentEntity;
    assetImpRecords.push(row);
    return row;
  });
  const assetImpList = jest.fn(async (org: string) =>
    assetImpRecords.filter((r) => r.organizationId === org),
  );
  const assetImpSum = jest.fn(async () => 0);

  const invImpCreate = jest.fn(async (input: CreateInventoryImpairmentInput) => {
    const row: InventoryImpairmentEntity = {
      id: `iimp-${invImpRecords.length + 1}`,
      organizationId: input.organizationId as string,
      inventoryItemId: input.inventoryItemId,
      testDate: input.testDate,
      carryingAmount: input.carryingAmount,
      nrv: input.nrv,
      impairmentAmount: input.impairmentAmount,
      type: input.type,
      journalEntryId: input.journalEntryId ?? null,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
      createdAt: new Date(),
    } as InventoryImpairmentEntity;
    invImpRecords.push(row);
    return row;
  });
  const invImpList = jest.fn(async (org: string) =>
    invImpRecords.filter((r) => r.organizationId === org),
  );
  const invImpSum = jest.fn(async () => 0);

  const assetImpRepoMock = {
    create: assetImpCreate,
    listByOrganization: assetImpList,
    sumNetImpairmentsForAsset: assetImpSum,
  } as unknown as AssetImpairmentsRepository;

  const invImpRepoMock = {
    create: invImpCreate,
    listByOrganization: invImpList,
    sumNetImpairmentsForItem: invImpSum,
  } as unknown as InventoryImpairmentsRepository;

  // Repos consommés — mocks plats.
  const assetsRepoFindById = jest.fn();
  const assetsRepoMock = { findById: assetsRepoFindById } as unknown as AssetsRepository;

  const schedulesListByAsset = jest.fn();
  const schedulesRepoMock = {
    listByAsset: schedulesListByAsset,
  } as unknown as DepreciationSchedulesRepository;

  const inventoryFindById = jest.fn();
  const inventoryRepoMock = {
    findById: inventoryFindById,
  } as unknown as InventoryItemRepository;

  const accountsFindById = jest.fn();
  const accountsRepoMock = {
    findById: accountsFindById,
    findByCode: jest.fn(),
  } as unknown as OrganizationAccountRepository;

  const createDraft = jest.fn(async () => ({ id: 'je-new' }));
  const validateEntry = jest.fn(async () => undefined);
  const entriesServiceMock = {
    createDraft,
    validate: validateEntry,
  } as unknown as EntriesService;

  const recordAudit = jest.fn().mockResolvedValue(null);
  const auditMock = { record: recordAudit } as unknown as AuditTrailService;

  const dataSource = {
    transaction: <T>(fn: (m: EntityManager) => Promise<T>) => fn({} as EntityManager),
  } as unknown as DataSource;

  const service = new ImpairmentsService(
    dataSource,
    assetImpRepoMock,
    invImpRepoMock,
    assetsRepoMock,
    schedulesRepoMock,
    inventoryRepoMock,
    accountsRepoMock,
    entriesServiceMock,
    auditMock,
  );

  return {
    service,
    assetImpRepo: {
      create: assetImpCreate,
      listByOrganization: assetImpList,
      sumNetImpairmentsForAsset: assetImpSum,
    },
    invImpRepo: {
      create: invImpCreate,
      listByOrganization: invImpList,
      sumNetImpairmentsForItem: invImpSum,
    },
    assetsRepoFindById,
    schedulesListByAsset,
    inventoryFindById,
    accountsFindById,
    createDraft,
    validateEntry,
    recordAudit,
  };
}

describe('ImpairmentsService (W3.2)', () => {
  describe('testAssetImpairment — dépréciation', () => {
    it('detects carrying > recoverable and posts D 6917 / C 29x', async () => {
      const h = buildHarness();
      const asset = buildAsset();
      h.assetsRepoFindById.mockResolvedValue(asset);
      h.schedulesListByAsset.mockResolvedValue([
        buildSchedule({
          periodEnd: '2024-12-31',
          netBookValue: '100000.00',
          cumulativeDepreciation: '20000.00',
        }),
      ]);
      h.accountsFindById.mockResolvedValue({ id: 'acc-241', code: '241' });
      h.assetImpRepo.sumNetImpairmentsForAsset.mockResolvedValue(0);

      const result = await h.service.testAssetImpairment(
        ORG_ID,
        { assetId: 'asset-1', testDate: '2025-06-30', recoverableAmount: '80000.00' },
        ACTOR_ID,
        CTX,
      );

      expect(result.type).toBe('depreciation');
      expect(result.impairmentAmount).toBe('20000.00');
      expect(result.carryingAmount).toBe('100000.00');
      expect(result.recoverableAmount).toBe('80000.00');
      expect(result.journalEntryId).toBe('je-new');

      expect(h.createDraft).toHaveBeenCalledTimes(1);
      const draftCall = h.createDraft.mock.calls[0];
      const entryInput = draftCall[1];
      expect(entryInput.sourceType).toBe('impairment');
      expect(entryInput.lines).toEqual([
        expect.objectContaining({ accountCode: '6917', debit: 20000, credit: 0 }),
        expect.objectContaining({ accountCode: '294', debit: 0, credit: 20000 }),
      ]);
      expect(h.validateEntry).toHaveBeenCalledWith(ORG_ID, 'je-new', ACTOR_ID, CTX);
    });

    it('records a neutral test (amount=0) when carrying ≈ recoverable', async () => {
      const h = buildHarness();
      h.assetsRepoFindById.mockResolvedValue(buildAsset());
      h.schedulesListByAsset.mockResolvedValue([
        buildSchedule({ periodEnd: '2024-12-31', netBookValue: '100000.00' }),
      ]);
      h.assetImpRepo.sumNetImpairmentsForAsset.mockResolvedValue(0);

      const result = await h.service.testAssetImpairment(
        ORG_ID,
        { assetId: 'asset-1', testDate: '2025-06-30', recoverableAmount: '100000.00' },
        ACTOR_ID,
        CTX,
      );

      expect(result.impairmentAmount).toBe('0.00');
      expect(result.journalEntryId).toBeNull();
      expect(h.createDraft).not.toHaveBeenCalled();
    });
  });

  describe('testAssetImpairment — reprise plafonnée (App. 44)', () => {
    it('caps the reprise at the cumulated impairment history', async () => {
      const h = buildHarness();
      h.assetsRepoFindById.mockResolvedValue(buildAsset());
      h.schedulesListByAsset.mockResolvedValue([
        buildSchedule({ periodEnd: '2024-12-31', netBookValue: '80000.00' }),
      ]);
      h.accountsFindById.mockResolvedValue({ id: 'acc-241', code: '241' });
      // Cumul net déprécié = 20000 — reprise demandée 30000 > 20000 → erreur.
      h.assetImpRepo.sumNetImpairmentsForAsset.mockResolvedValue(20000);

      await expect(
        h.service.testAssetImpairment(
          ORG_ID,
          { assetId: 'asset-1', testDate: '2025-06-30', recoverableAmount: '110000.00' },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toMatchObject({
        code: ERROR_CODES.IMPAIRMENT_REPRISE_EXCEEDS_HISTORY,
        status: 422,
      });
    });

    it('books a reprise D 29x / C 7917 when within history bounds', async () => {
      const h = buildHarness();
      h.assetsRepoFindById.mockResolvedValue(buildAsset());
      h.schedulesListByAsset.mockResolvedValue([
        buildSchedule({ periodEnd: '2024-12-31', netBookValue: '80000.00' }),
      ]);
      h.accountsFindById.mockResolvedValue({ id: 'acc-241', code: '241' });
      h.assetImpRepo.sumNetImpairmentsForAsset.mockResolvedValue(20000);

      const result = await h.service.testAssetImpairment(
        ORG_ID,
        { assetId: 'asset-1', testDate: '2025-06-30', recoverableAmount: '95000.00' },
        ACTOR_ID,
        CTX,
      );

      expect(result.type).toBe('reprise');
      expect(result.impairmentAmount).toBe('15000.00');
      const entryInput = h.createDraft.mock.calls[0][1];
      expect(entryInput.lines).toEqual([
        expect.objectContaining({ accountCode: '294', debit: 15000, credit: 0 }),
        expect.objectContaining({ accountCode: '7917', debit: 0, credit: 15000 }),
      ]);
    });
  });

  describe('testAssetImpairment — guards', () => {
    it('throws IMPAIRMENT_ASSET_NOT_FOUND when asset missing', async () => {
      const h = buildHarness();
      h.assetsRepoFindById.mockResolvedValue(null);

      await expect(
        h.service.testAssetImpairment(
          ORG_ID,
          { assetId: 'missing', testDate: '2025-06-30', recoverableAmount: '0.00' },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toMatchObject({
        code: ERROR_CODES.IMPAIRMENT_ASSET_NOT_FOUND,
        status: 404,
      });
    });

    it('throws IMPAIRMENT_INVALID_AMOUNT for negative recoverableAmount input', async () => {
      const h = buildHarness();
      h.assetsRepoFindById.mockResolvedValue(buildAsset());

      await expect(
        h.service.testAssetImpairment(
          ORG_ID,
          { assetId: 'asset-1', testDate: '2025-06-30', recoverableAmount: '-10' },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toBeInstanceOf(AppException);
    });

    it('isolates tenants — sumNetImpairmentsForAsset is called with the calling org', async () => {
      const h = buildHarness();
      h.assetsRepoFindById.mockResolvedValue(buildAsset({ organizationId: ORG_ID }));
      h.schedulesListByAsset.mockResolvedValue([
        buildSchedule({ periodEnd: '2024-12-31', netBookValue: '100000.00' }),
      ]);
      h.accountsFindById.mockResolvedValue({ id: 'acc-241', code: '241' });

      await h.service.testAssetImpairment(
        ORG_ID,
        { assetId: 'asset-1', testDate: '2025-06-30', recoverableAmount: '70000.00' },
        ACTOR_ID,
        CTX,
      );

      expect(h.assetsRepoFindById).toHaveBeenCalledWith('asset-1', ORG_ID);
      expect(h.schedulesListByAsset).toHaveBeenCalledWith('asset-1', ORG_ID);
      expect(h.assetImpRepo.sumNetImpairmentsForAsset).toHaveBeenCalledWith('asset-1', ORG_ID);
      expect(h.assetImpRepo.sumNetImpairmentsForAsset).not.toHaveBeenCalledWith(
        'asset-1',
        OTHER_ORG_ID,
      );
    });
  });

  describe('testInventoryImpairment', () => {
    it('books D 6593 / C 39x when NRV < CMUP × Qté', async () => {
      const h = buildHarness();
      h.inventoryFindById.mockResolvedValue(
        buildInventoryItem({ currentQty: '100.0000', currentCmp: '50.0000' }),
      );
      h.accountsFindById.mockResolvedValue({ id: 'acc-311', code: '311' });
      h.invImpRepo.sumNetImpairmentsForItem.mockResolvedValue(0);

      const result = await h.service.testInventoryImpairment(
        ORG_ID,
        { inventoryItemId: 'item-1', testDate: '2025-06-30', nrv: '4000.00' },
        ACTOR_ID,
        CTX,
      );

      expect(result.type).toBe('depreciation');
      expect(result.carryingAmount).toBe('5000.00');
      expect(result.impairmentAmount).toBe('1000.00');
      const entryInput = h.createDraft.mock.calls[0][1];
      expect(entryInput.lines).toEqual([
        expect.objectContaining({ accountCode: '6593', debit: 1000, credit: 0 }),
        expect.objectContaining({ accountCode: '391', debit: 0, credit: 1000 }),
      ]);
    });

    it('throws IMPAIRMENT_INVENTORY_NOT_FOUND when item missing', async () => {
      const h = buildHarness();
      h.inventoryFindById.mockResolvedValue(null);

      await expect(
        h.service.testInventoryImpairment(
          ORG_ID,
          { inventoryItemId: 'missing', testDate: '2025-06-30', nrv: '0.00' },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toMatchObject({
        code: ERROR_CODES.IMPAIRMENT_INVENTORY_NOT_FOUND,
        status: 404,
      });
    });

    it('caps inventory reprise at sum of prior impairments', async () => {
      const h = buildHarness();
      h.inventoryFindById.mockResolvedValue(
        buildInventoryItem({ currentQty: '100.0000', currentCmp: '50.0000' }),
      );
      h.accountsFindById.mockResolvedValue({ id: 'acc-311', code: '311' });
      h.invImpRepo.sumNetImpairmentsForItem.mockResolvedValue(500);

      // Carrying = 5000, NRV = 7000 → reprise voulue 2000 > prior 500.
      await expect(
        h.service.testInventoryImpairment(
          ORG_ID,
          { inventoryItemId: 'item-1', testDate: '2025-06-30', nrv: '7000.00' },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toMatchObject({
        code: ERROR_CODES.IMPAIRMENT_REPRISE_EXCEEDS_HISTORY,
        status: 422,
      });
    });
  });

  describe('list queries', () => {
    it('listAssetImpairments forwards tenant + filters', async () => {
      const h = buildHarness();
      await h.service.listAssetImpairments(ORG_ID, 'asset-1', 10);
      expect(h.assetImpRepo.listByOrganization).toHaveBeenCalledWith(ORG_ID, 'asset-1', 10);
    });

    it('listInventoryImpairments forwards tenant + filters', async () => {
      const h = buildHarness();
      await h.service.listInventoryImpairments(ORG_ID, 'item-1', 5);
      expect(h.invImpRepo.listByOrganization).toHaveBeenCalledWith(ORG_ID, 'item-1', 5);
    });
  });
});
