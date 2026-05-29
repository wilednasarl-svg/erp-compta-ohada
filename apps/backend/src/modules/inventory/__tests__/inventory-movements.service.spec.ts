import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { EntriesService } from '../../journals/services/entries.service';
import type { InventoryItemEntity } from '../entities/inventory-item.entity';
import type { InventoryLotEntity } from '../entities/inventory-lot.entity';
import type { InventoryItemRepository } from '../repositories/inventory-item.repository';
import type { InventoryLotsRepository } from '../repositories/inventory-lot.repository';
import type { InventoryMovementRepository } from '../repositories/inventory-movement.repository';
import { InventoryMovementsService } from '../services/inventory-movements.service';
import type { InventoryItemsService } from '../services/inventory-items.service';

/**
 * Tests d'intégration légers : mocks de repos + DataSource + EntriesService.
 * Vérifie le contrat W4.2 :
 *  - écriture auto D 311 / C 6031 sur purchase
 *  - création de lot FIFO sur purchase si item.valuationMethod = fifo
 *  - sale FIFO consomme les lots dans l'ordre + écriture au totalCost FIFO
 *  - sale CMP utilise le CMUP courant (comportement legacy)
 *  - INVENTORY_FIFO_INSUFFICIENT_STOCK si lots insuffisants
 *  - sans accountCode : pas d'écriture (warning)
 */

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const ITEM_ID = '00000000-0000-0000-0000-000000000010';
const ACTOR_ID = '00000000-0000-0000-0000-0000000000aa';

function buildItem(overrides: Partial<InventoryItemEntity> = {}): InventoryItemEntity {
  return {
    id: ITEM_ID,
    organizationId: ORG_ID,
    code: 'SKU-1',
    label: 'Test item',
    unitOfMeasure: 'unit',
    family: 'marchandises',
    stockAccountId: 'acc-stock',
    purchaseAccountId: 'acc-purchase',
    saleAccountId: null,
    currentQty: '0.0000',
    currentCmp: '0.0000',
    status: 'active',
    valuationMethod: 'cmp',
    accountCode: '311',
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    organization: undefined as never,
    ...overrides,
  };
}

interface Mocks {
  itemsRepo: jest.Mocked<InventoryItemRepository>;
  movementsRepo: jest.Mocked<InventoryMovementRepository>;
  itemsService: jest.Mocked<InventoryItemsService>;
  lotsRepo: jest.Mocked<InventoryLotsRepository>;
  entries: jest.Mocked<EntriesService>;
  itemRow: InventoryItemEntity;
}

function buildService(opts: {
  item?: Partial<InventoryItemEntity>;
  lots?: InventoryLotEntity[];
  withEntries?: boolean;
}): { service: InventoryMovementsService; mocks: Mocks } {
  const itemRow = buildItem(opts.item ?? {});
  const lots = opts.lots ?? [];

  // Fake EntityManager: returns a fake repo with the methods we touch.
  const fakeRepo = {
    createQueryBuilder: () => ({
      where: function () {
        return this;
      },
      andWhere: function () {
        return this;
      },
      orderBy: function () {
        return this;
      },
      addOrderBy: function () {
        return this;
      },
      setLock: function () {
        return this;
      },
      getOne: async () => itemRow,
      getMany: async () => lots,
    }),
    findOneOrFail: async () => itemRow,
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const fakeManager = {
    getRepository: () => fakeRepo,
  } as unknown as Parameters<Parameters<jest.Mock>[0]>[0];

  const dataSource = {
    transaction: jest.fn(async (cb: (m: typeof fakeManager) => Promise<unknown>) =>
      cb(fakeManager),
    ),
  } as unknown as ConstructorParameters<typeof InventoryMovementsService>[0];

  const itemsRepo = {
    updateState: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<InventoryItemRepository>;

  const movementsRepo = {
    create: jest.fn(async (input) => ({
      id: 'mov-1',
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      type: input.type,
      movementDate: input.movementDate,
      qty: input.qty,
      unitPrice: input.unitPrice ?? null,
      qtyAfter: input.qtyAfter,
      cmpAfter: input.cmpAfter,
      movementValue: input.movementValue,
      reference: null,
      description: null,
      journalEntryId: null,
      createdById: ACTOR_ID,
      createdAt: new Date(),
      organization: undefined as never,
      item: undefined as never,
    })) as unknown as jest.Mock,
    list: jest.fn(),
    findById: jest.fn(),
  } as unknown as jest.Mocked<InventoryMovementRepository>;

  const itemsService = {
    findById: jest.fn().mockResolvedValue(itemRow),
  } as unknown as jest.Mocked<InventoryItemsService>;

  const lotsRepo = {
    create: jest.fn(async (input) => ({
      id: `lot-${Math.random().toString(36).slice(2, 8)}`,
      organizationId: input.organizationId,
      inventoryItemId: input.inventoryItemId,
      entryDate: input.entryDate,
      initialQty: input.initialQty,
      remainingQty: input.initialQty,
      unitCost: input.unitCost,
      sourceMovementId: input.sourceMovementId ?? null,
      createdAt: new Date(),
      organization: undefined as never,
      item: undefined as never,
      sourceMovement: null,
    })),
    findByItem: jest.fn().mockResolvedValue(lots),
    listAvailable: jest.fn().mockResolvedValue(lots),
    updateRemainingQty: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<InventoryLotsRepository>;

  const entries = {
    createDraft: jest.fn().mockResolvedValue({ id: 'entry-1' }),
  } as unknown as jest.Mocked<EntriesService>;

  const service = new InventoryMovementsService(
    dataSource,
    itemsRepo,
    movementsRepo,
    itemsService,
    lotsRepo,
    opts.withEntries === false ? null : entries,
  );

  return {
    service,
    mocks: { itemsRepo, movementsRepo, itemsService, lotsRepo, entries, itemRow },
  };
}

describe('InventoryMovementsService — W4.2', () => {
  // ─── Partie A : auto-écritures ──────────────────────────────────────

  it('purchase: génère écriture D 311 / C 6031 + persiste le mouvement', async () => {
    const { service, mocks } = buildService({});
    await service.recordMovement(
      ORG_ID as never,
      ITEM_ID,
      {
        type: 'purchase',
        movementDate: '2026-01-15',
        qty: '10',
        unitPrice: '100',
      },
      ACTOR_ID,
    );

    expect(mocks.movementsRepo.create).toHaveBeenCalledTimes(1);
    expect(mocks.entries.createDraft).toHaveBeenCalledTimes(1);

    const call = mocks.entries.createDraft.mock.calls[0];
    const input = call[1];
    expect(input.journalCode).toBe('OD');
    expect(input.lines).toHaveLength(2);
    expect(input.lines[0].accountCode).toBe('311');
    expect(input.lines[0].debit).toBeCloseTo(1000, 2);
    expect(input.lines[0].credit).toBe(0);
    expect(input.lines[1].accountCode).toBe('6031');
    expect(input.lines[1].debit).toBe(0);
    expect(input.lines[1].credit).toBeCloseTo(1000, 2);
  });

  it('sale CMP: utilise le CMUP courant + écriture D 6031 / C 311', async () => {
    const { service, mocks } = buildService({
      item: { currentQty: '100.0000', currentCmp: '50.0000', valuationMethod: 'cmp' },
    });

    await service.recordMovement(
      ORG_ID as never,
      ITEM_ID,
      { type: 'sale', movementDate: '2026-01-15', qty: '10' },
      ACTOR_ID,
    );

    expect(mocks.lotsRepo.listAvailable).not.toHaveBeenCalled();
    expect(mocks.entries.createDraft).toHaveBeenCalledTimes(1);
    const lines = mocks.entries.createDraft.mock.calls[0][1].lines;
    expect(lines[0].accountCode).toBe('6031');
    expect(lines[0].debit).toBeCloseTo(500, 2);
    expect(lines[1].accountCode).toBe('311');
    expect(lines[1].credit).toBeCloseTo(500, 2);
  });

  it('purchase FIFO: crée un lot via lotsRepo.create', async () => {
    const { service, mocks } = buildService({
      item: { valuationMethod: 'fifo' },
    });

    await service.recordMovement(
      ORG_ID as never,
      ITEM_ID,
      {
        type: 'purchase',
        movementDate: '2026-01-15',
        qty: '30',
        unitPrice: '100',
      },
      ACTOR_ID,
    );

    expect(mocks.lotsRepo.create).toHaveBeenCalledTimes(1);
    const lotInput = mocks.lotsRepo.create.mock.calls[0][0];
    expect(lotInput.initialQty).toBe('30');
    expect(lotInput.unitCost).toBe('100');
    expect(lotInput.sourceMovementId).toBe('mov-1');
  });

  it("sale FIFO: consomme les lots dans l'ordre + écriture au totalCost FIFO", async () => {
    const lot1: InventoryLotEntity = {
      id: 'lot-1',
      organizationId: ORG_ID,
      inventoryItemId: ITEM_ID,
      entryDate: '2026-01-01',
      initialQty: '30.0000',
      remainingQty: '30.0000',
      unitCost: '100.0000',
      sourceMovementId: null,
      createdAt: new Date(),
      organization: undefined as never,
      item: undefined as never,
      sourceMovement: null,
    };
    const lot2: InventoryLotEntity = {
      ...lot1,
      id: 'lot-2',
      entryDate: '2026-01-10',
      initialQty: '100.0000',
      remainingQty: '100.0000',
      unitCost: '110.0000',
    };

    const { service, mocks } = buildService({
      item: { valuationMethod: 'fifo', currentQty: '130.0000', currentCmp: '108.0000' },
      lots: [lot1, lot2],
    });

    await service.recordMovement(
      ORG_ID as never,
      ITEM_ID,
      { type: 'sale', movementDate: '2026-01-15', qty: '50' },
      ACTOR_ID,
    );

    expect(mocks.lotsRepo.listAvailable).toHaveBeenCalledTimes(1);
    // 30 from lot-1 + 20 from lot-2 → 2 updateRemainingQty calls
    expect(mocks.lotsRepo.updateRemainingQty).toHaveBeenCalledTimes(2);
    expect(mocks.lotsRepo.updateRemainingQty.mock.calls[0][0]).toBe('lot-1');
    expect(mocks.lotsRepo.updateRemainingQty.mock.calls[0][1]).toBe('0.0000');
    expect(mocks.lotsRepo.updateRemainingQty.mock.calls[1][0]).toBe('lot-2');
    expect(mocks.lotsRepo.updateRemainingQty.mock.calls[1][1]).toBe('80.0000');

    // Total cost = 30 × 100 + 20 × 110 = 5200
    const lines = mocks.entries.createDraft.mock.calls[0][1].lines;
    expect(lines[0].debit).toBeCloseTo(5200, 2);
  });

  it('sale FIFO insuffisant: lève INVENTORY_FIFO_INSUFFICIENT_STOCK', async () => {
    const lot: InventoryLotEntity = {
      id: 'lot-1',
      organizationId: ORG_ID,
      inventoryItemId: ITEM_ID,
      entryDate: '2026-01-01',
      initialQty: '10.0000',
      remainingQty: '10.0000',
      unitCost: '50.0000',
      sourceMovementId: null,
      createdAt: new Date(),
      organization: undefined as never,
      item: undefined as never,
      sourceMovement: null,
    };

    const { service } = buildService({
      item: { valuationMethod: 'fifo', currentQty: '10.0000' },
      lots: [lot],
    });

    await expect(
      service.recordMovement(
        ORG_ID as never,
        ITEM_ID,
        { type: 'sale', movementDate: '2026-01-15', qty: '20' },
        ACTOR_ID,
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVENTORY_FIFO_INSUFFICIENT_STOCK,
    });
  });

  it("item sans accountCode: mouvement persisté, pas d'écriture (warning)", async () => {
    const { service, mocks } = buildService({
      item: { accountCode: null },
    });

    const result = await service.recordMovement(
      ORG_ID as never,
      ITEM_ID,
      {
        type: 'purchase',
        movementDate: '2026-01-15',
        qty: '10',
        unitPrice: '100',
      },
      ACTOR_ID,
    );

    expect(result.movement).toBeDefined();
    expect(mocks.movementsRepo.create).toHaveBeenCalledTimes(1);
    expect(mocks.entries.createDraft).not.toHaveBeenCalled();
  });

  it("EntriesService non câblé: mouvement persisté, pas d'écriture", async () => {
    const { service, mocks } = buildService({ withEntries: false });

    await service.recordMovement(
      ORG_ID as never,
      ITEM_ID,
      {
        type: 'purchase',
        movementDate: '2026-01-15',
        qty: '5',
        unitPrice: '20',
      },
      ACTOR_ID,
    );

    expect(mocks.movementsRepo.create).toHaveBeenCalledTimes(1);
    // entries.createDraft is on the optional mock but service skipped it.
    expect(mocks.entries.createDraft).not.toHaveBeenCalled();
  });

  it('adjustment positif: écriture D 311 / C 7133 (variation positive)', async () => {
    const { service, mocks } = buildService({
      item: { currentQty: '100.0000', currentCmp: '50.0000' },
    });

    await service.recordMovement(
      ORG_ID as never,
      ITEM_ID,
      {
        type: 'adjustment',
        movementDate: '2026-01-15',
        qty: '5',
        unitPrice: '60',
      },
      ACTOR_ID,
    );

    expect(mocks.entries.createDraft).toHaveBeenCalledTimes(1);
    const lines = mocks.entries.createDraft.mock.calls[0][1].lines;
    expect(lines[0].accountCode).toBe('311');
    expect(lines[1].accountCode).toBe('7133');
  });

  it("production: pas d'écriture comptable générée (out of scope W4.2)", async () => {
    const { service, mocks } = buildService({
      item: { currentQty: '100.0000', currentCmp: '50.0000' },
    });

    await service.recordMovement(
      ORG_ID as never,
      ITEM_ID,
      {
        type: 'production',
        movementDate: '2026-01-15',
        qty: '5',
        unitPrice: '60',
      },
      ACTOR_ID,
    );

    expect(mocks.entries.createDraft).not.toHaveBeenCalled();
  });

  it('échec génération écriture: log warning mais mouvement persisté', async () => {
    const { service, mocks } = buildService({});
    mocks.entries.createDraft.mockRejectedValueOnce(
      new AppException(ERROR_CODES.JOURNAL_NOT_FOUND),
    );

    const result = await service.recordMovement(
      ORG_ID as never,
      ITEM_ID,
      {
        type: 'purchase',
        movementDate: '2026-01-15',
        qty: '10',
        unitPrice: '100',
      },
      ACTOR_ID,
    );

    expect(result.movement).toBeDefined();
    expect(result.movement.journalEntryId).toBeNull();
  });
});
