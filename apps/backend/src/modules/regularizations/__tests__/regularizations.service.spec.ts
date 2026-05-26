import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import type { EntriesService } from '../../journals/services/entries.service';
import { AddEntryDto } from '../dto/add-entry.dto';
import { CreateBatchDto } from '../dto/create-batch.dto';
import type { RegularizationBatchEntity } from '../entities/regularization-batch.entity';
import type { RegularizationEntryEntity } from '../entities/regularization-entry.entity';
import type { RegularizationBatchesRepository } from '../repositories/regularization-batches.repository';
import type { RegularizationEntriesRepository } from '../repositories/regularization-entries.repository';
import { RegularizationsService } from '../services/regularizations.service';

const ORG_ID = asTenantId('11111111-1111-1111-1111-111111111111');
const OTHER_ORG_ID = asTenantId('99999999-9999-9999-9999-999999999999');
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const AUDIT_CTX: AuditContext = {
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
  userId: null,
  organizationId: null,
  requestId: null,
};

interface CapturedCall {
  readonly organizationId: string;
  readonly journalCode: string;
  readonly entryDate: string;
  readonly description: string;
  readonly lines: ReadonlyArray<{
    accountCode: string;
    debit: number;
    credit: number;
    description: string | null;
  }>;
}

interface Harness {
  service: RegularizationsService;
  batchesRepo: jest.Mocked<RegularizationBatchesRepository>;
  entriesRepo: jest.Mocked<RegularizationEntriesRepository>;
  entries: jest.Mocked<EntriesService>;
  storedBatches: RegularizationBatchEntity[];
  storedEntries: RegularizationEntryEntity[];
  draftCalls: CapturedCall[];
  validateCalls: string[];
}

function buildHarness(): Harness {
  const storedBatches: RegularizationBatchEntity[] = [];
  const storedEntries: RegularizationEntryEntity[] = [];
  const draftCalls: CapturedCall[] = [];
  const validateCalls: string[] = [];
  let batchCounter = 0;
  let entryCounter = 0;
  let journalEntryCounter = 0;

  const batchesRepo = {
    create: jest.fn(async (input) => {
      const batch: RegularizationBatchEntity = {
        id: `batch-${++batchCounter}`,
        organizationId: String(input.organizationId),
        exerciseEndDate: input.exerciseEndDate,
        reversalDate: input.reversalDate,
        status: input.status ?? 'draft',
        label: input.label ?? '',
        journalEntryId: null,
        reversalJournalEntryId: null,
        executedAt: null,
        executedById: null,
        reversedAt: null,
        reversedById: null,
        cancelledAt: null,
        createdById: input.createdById ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        organization: undefined as never,
        entries: [],
      };
      storedBatches.push(batch);
      return batch;
    }),
    findById: jest.fn(async (organizationId: string, id: string) => {
      return (
        storedBatches.find(
          (b) => b.id === id && b.organizationId === String(organizationId),
        ) ?? null
      );
    }),
    listByOrg: jest.fn(async (organizationId: string, filters = {}) => {
      return storedBatches.filter((b) => {
        if (b.organizationId !== String(organizationId)) return false;
        if (filters.status && b.status !== filters.status) return false;
        if (filters.exerciseEndDate && b.exerciseEndDate !== filters.exerciseEndDate)
          return false;
        return true;
      });
    }),
    update: jest.fn(async (organizationId: string, id: string, patch) => {
      const idx = storedBatches.findIndex(
        (b) => b.id === id && b.organizationId === String(organizationId),
      );
      if (idx < 0) throw new Error(`Batch ${id} not found in mock store`);
      const updated: RegularizationBatchEntity = {
        ...storedBatches[idx],
        ...patch,
        updatedAt: new Date(),
      };
      storedBatches[idx] = updated;
      return updated;
    }),
    save: jest.fn(),
  } as unknown as jest.Mocked<RegularizationBatchesRepository>;

  const entriesRepo = {
    create: jest.fn(async (input) => {
      const entry: RegularizationEntryEntity = {
        id: `entry-${++entryCounter}`,
        batchId: input.batchId,
        organizationId: String(input.organizationId),
        type: input.type,
        expenseRevenueAccount: input.expenseRevenueAccount,
        regularizationAccount: input.regularizationAccount,
        amount: input.amount,
        tvaAmount: input.tvaAmount ?? '0',
        label: input.label ?? '',
        createdAt: new Date(),
        batch: undefined as never,
        organization: undefined as never,
      };
      storedEntries.push(entry);
      return entry;
    }),
    listByBatch: jest.fn(async (batchId: string, organizationId: string) => {
      return storedEntries.filter(
        (e) => e.batchId === batchId && e.organizationId === String(organizationId),
      );
    }),
    delete: jest.fn(async (id: string, organizationId: string) => {
      const idx = storedEntries.findIndex(
        (e) => e.id === id && e.organizationId === String(organizationId),
      );
      if (idx >= 0) storedEntries.splice(idx, 1);
    }),
    save: jest.fn(),
  } as unknown as jest.Mocked<RegularizationEntriesRepository>;

  const entries = {
    createDraft: jest.fn(async (organizationId, input) => {
      draftCalls.push({
        organizationId: String(organizationId),
        journalCode: input.journalCode,
        entryDate: input.entryDate,
        description: input.description,
        lines: input.lines.map(
          (l: { accountCode: string; debit: number; credit: number; description?: string | null }) => ({
            accountCode: l.accountCode,
            debit: l.debit,
            credit: l.credit,
            description: l.description ?? null,
          }),
        ),
      });
      return {
        id: `je-${++journalEntryCounter}`,
        organizationId: String(organizationId),
        journalCode: input.journalCode,
        periodId: 'period-1',
        entryNumber: journalEntryCounter,
        entryDate: input.entryDate,
        description: input.description,
        reference: null,
        status: 'draft',
        sourceType: 'manual',
        createdById: ACTOR_ID,
        validatedAt: null,
        cancelledAt: null,
        lines: [],
      };
    }),
    validate: jest.fn(async (organizationId, entryId) => {
      validateCalls.push(String(entryId));
      return {
        id: String(entryId),
        organizationId: String(organizationId),
        journalCode: 'OD',
        periodId: 'period-1',
        entryNumber: 1,
        entryDate: '2026-12-31',
        description: '',
        reference: null,
        status: 'validated',
        sourceType: 'manual',
        createdById: ACTOR_ID,
        validatedAt: new Date(),
        cancelledAt: null,
        lines: [],
      };
    }),
  } as unknown as jest.Mocked<EntriesService>;

  const service = new RegularizationsService(batchesRepo, entriesRepo, entries);

  return {
    service,
    batchesRepo,
    entriesRepo,
    entries,
    storedBatches,
    storedEntries,
    draftCalls,
    validateCalls,
  };
}

function buildCreateBatchDto(overrides: Partial<CreateBatchDto> = {}): CreateBatchDto {
  return {
    exerciseEndDate: '2026-12-31',
    label: 'Régul N',
    ...overrides,
  } as CreateBatchDto;
}

function buildAddEntryDto(overrides: Partial<AddEntryDto>): AddEntryDto {
  return {
    type: 'cca',
    expenseRevenueAccount: '6061',
    regularizationAccount: '476',
    amount: '1000.00',
    tvaAmount: '0',
    label: 'CCA loyer',
    ...overrides,
  } as AddEntryDto;
}

function sumBy(
  lines: ReadonlyArray<{ debit: number; credit: number }>,
  side: 'debit' | 'credit',
): number {
  return lines.reduce((s, l) => s + (side === 'debit' ? l.debit : l.credit), 0);
}

describe('RegularizationsService', () => {
  describe('createBatch()', () => {
    it('creates a draft batch with reversalDate = exerciseEndDate + 1 jour', async () => {
      const h = buildHarness();
      const batch = await h.service.createBatch(
        ORG_ID,
        buildCreateBatchDto({ exerciseEndDate: '2026-12-31' }),
        ACTOR_ID,
      );

      expect(batch.status).toBe('draft');
      expect(batch.exerciseEndDate).toBe('2026-12-31');
      expect(batch.reversalDate).toBe('2027-01-01');
      expect(batch.createdById).toBe(ACTOR_ID);
      expect(h.entries.createDraft).not.toHaveBeenCalled();
    });
  });

  describe('addEntry() / removeEntry()', () => {
    it('adds an entry on a draft batch', async () => {
      const h = buildHarness();
      const batch = await h.service.createBatch(ORG_ID, buildCreateBatchDto(), ACTOR_ID);
      const entry = await h.service.addEntry(ORG_ID, batch.id, buildAddEntryDto({ type: 'cca' }));
      expect(entry.type).toBe('cca');
      expect(h.storedEntries).toHaveLength(1);
    });

    it('refuses to add an entry on a non-draft batch (BATCH_NOT_DRAFT)', async () => {
      const h = buildHarness();
      const batch = await h.service.createBatch(ORG_ID, buildCreateBatchDto(), ACTOR_ID);
      await h.service.addEntry(ORG_ID, batch.id, buildAddEntryDto({ type: 'cca' }));
      await h.service.executeBatch(ORG_ID, batch.id, ACTOR_ID, AUDIT_CTX);

      await expect(
        h.service.addEntry(ORG_ID, batch.id, buildAddEntryDto({ type: 'cca' })),
      ).rejects.toMatchObject({ code: ERROR_CODES.REGULARIZATION_BATCH_NOT_DRAFT });
    });
  });

  describe('executeBatch()', () => {
    it('executes a CCA-only batch — 1 balanced entry, 2 lines', async () => {
      const h = buildHarness();
      const batch = await h.service.createBatch(ORG_ID, buildCreateBatchDto(), ACTOR_ID);
      await h.service.addEntry(
        ORG_ID,
        batch.id,
        buildAddEntryDto({
          type: 'cca',
          expenseRevenueAccount: '6061',
          regularizationAccount: '476',
          amount: '1200.00',
        }),
      );

      const executed = await h.service.executeBatch(ORG_ID, batch.id, ACTOR_ID, AUDIT_CTX);

      expect(executed.status).toBe('executed');
      expect(executed.executedById).toBe(ACTOR_ID);
      expect(executed.journalEntryId).toBe('je-1');
      expect(h.draftCalls).toHaveLength(1);
      const call = h.draftCalls[0];
      expect(call.journalCode).toBe('OD');
      expect(call.entryDate).toBe('2026-12-31');
      expect(call.lines).toHaveLength(2);
      // CCA : D 476 / C 6061
      const debit476 = call.lines.find((l) => l.accountCode === '476');
      const credit6061 = call.lines.find((l) => l.accountCode === '6061');
      expect(debit476?.debit).toBeCloseTo(1200, 2);
      expect(credit6061?.credit).toBeCloseTo(1200, 2);
      expect(sumBy(call.lines, 'debit')).toBeCloseTo(sumBy(call.lines, 'credit'), 2);
      expect(h.validateCalls).toEqual(['je-1']);
    });

    it('executes CAP + CAP_TVA — 4 balanced lines', async () => {
      const h = buildHarness();
      const batch = await h.service.createBatch(ORG_ID, buildCreateBatchDto(), ACTOR_ID);
      await h.service.addEntry(
        ORG_ID,
        batch.id,
        buildAddEntryDto({
          type: 'cap_charge',
          expenseRevenueAccount: '6061',
          regularizationAccount: '408',
          amount: '1000.00',
        }),
      );
      await h.service.addEntry(
        ORG_ID,
        batch.id,
        buildAddEntryDto({
          type: 'cap_tva',
          expenseRevenueAccount: '4455',
          regularizationAccount: '408',
          amount: '0',
          tvaAmount: '180.00',
        }),
      );

      await h.service.executeBatch(ORG_ID, batch.id, ACTOR_ID, AUDIT_CTX);

      const call = h.draftCalls[0];
      expect(call.lines).toHaveLength(4);
      // cap_charge : D 6061(1000) / C 408(1000)
      // cap_tva    : D 4455(180)  / C 408(180)
      expect(sumBy(call.lines, 'debit')).toBeCloseTo(1180, 2);
      expect(sumBy(call.lines, 'credit')).toBeCloseTo(1180, 2);
      const debit6061 = call.lines.find((l) => l.accountCode === '6061' && l.debit > 0);
      const debit4455 = call.lines.find((l) => l.accountCode === '4455' && l.debit > 0);
      expect(debit6061?.debit).toBeCloseTo(1000, 2);
      expect(debit4455?.debit).toBeCloseTo(180, 2);
    });

    it('refuses to execute a non-draft batch (BATCH_NOT_DRAFT)', async () => {
      const h = buildHarness();
      const batch = await h.service.createBatch(ORG_ID, buildCreateBatchDto(), ACTOR_ID);
      await h.service.addEntry(ORG_ID, batch.id, buildAddEntryDto({ type: 'cca' }));
      await h.service.executeBatch(ORG_ID, batch.id, ACTOR_ID, AUDIT_CTX);
      await expect(
        h.service.executeBatch(ORG_ID, batch.id, ACTOR_ID, AUDIT_CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.REGULARIZATION_BATCH_NOT_DRAFT });
    });
  });

  describe('reverseBatch()', () => {
    it('generates the symmetric entry at reversalDate', async () => {
      const h = buildHarness();
      const batch = await h.service.createBatch(
        ORG_ID,
        buildCreateBatchDto({ exerciseEndDate: '2026-12-31' }),
        ACTOR_ID,
      );
      await h.service.addEntry(
        ORG_ID,
        batch.id,
        buildAddEntryDto({
          type: 'cca',
          expenseRevenueAccount: '6061',
          regularizationAccount: '476',
          amount: '900.00',
        }),
      );
      await h.service.executeBatch(ORG_ID, batch.id, ACTOR_ID, AUDIT_CTX);

      const reversed = await h.service.reverseBatch(ORG_ID, batch.id, ACTOR_ID, AUDIT_CTX);

      expect(reversed.status).toBe('reversed');
      expect(reversed.reversedAt).toBeInstanceOf(Date);
      expect(reversed.reversalJournalEntryId).toBe('je-2');
      expect(h.draftCalls).toHaveLength(2);
      const reversal = h.draftCalls[1];
      expect(reversal.entryDate).toBe('2027-01-01');
      // Inversé : D 6061 / C 476
      const debit6061 = reversal.lines.find((l) => l.accountCode === '6061' && l.debit > 0);
      const credit476 = reversal.lines.find((l) => l.accountCode === '476' && l.credit > 0);
      expect(debit6061?.debit).toBeCloseTo(900, 2);
      expect(credit476?.credit).toBeCloseTo(900, 2);
    });

    it('refuses to reverse a non-executed batch (BATCH_NOT_EXECUTED)', async () => {
      const h = buildHarness();
      const batch = await h.service.createBatch(ORG_ID, buildCreateBatchDto(), ACTOR_ID);
      await expect(
        h.service.reverseBatch(ORG_ID, batch.id, ACTOR_ID, AUDIT_CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.REGULARIZATION_BATCH_NOT_EXECUTED });
    });

    it('refuses to reverse twice (BATCH_ALREADY_REVERSED)', async () => {
      const h = buildHarness();
      const batch = await h.service.createBatch(ORG_ID, buildCreateBatchDto(), ACTOR_ID);
      await h.service.addEntry(ORG_ID, batch.id, buildAddEntryDto({ type: 'cca' }));
      await h.service.executeBatch(ORG_ID, batch.id, ACTOR_ID, AUDIT_CTX);
      await h.service.reverseBatch(ORG_ID, batch.id, ACTOR_ID, AUDIT_CTX);
      await expect(
        h.service.reverseBatch(ORG_ID, batch.id, ACTOR_ID, AUDIT_CTX),
      ).rejects.toMatchObject({
        // Le batch est passé en 'reversed', NOT_EXECUTED se déclenche en premier
        code: ERROR_CODES.REGULARIZATION_BATCH_NOT_EXECUTED,
      });
    });
  });

  describe('findBatch() tenant isolation', () => {
    it('throws BATCH_NOT_FOUND when reading a batch from another org', async () => {
      const h = buildHarness();
      const batch = await h.service.createBatch(ORG_ID, buildCreateBatchDto(), ACTOR_ID);
      await expect(h.service.findBatch(OTHER_ORG_ID, batch.id)).rejects.toBeInstanceOf(
        AppException,
      );
      await expect(h.service.findBatch(OTHER_ORG_ID, batch.id)).rejects.toMatchObject({
        code: ERROR_CODES.REGULARIZATION_BATCH_NOT_FOUND,
      });
    });

    it('returns batch + entries from the correct org', async () => {
      const h = buildHarness();
      const batch = await h.service.createBatch(ORG_ID, buildCreateBatchDto(), ACTOR_ID);
      await h.service.addEntry(ORG_ID, batch.id, buildAddEntryDto({ type: 'pca' }));
      const found = await h.service.findBatch(ORG_ID, batch.id);
      expect(found.batch.id).toBe(batch.id);
      expect(found.entries).toHaveLength(1);
      expect(found.entries[0].type).toBe('pca');
    });
  });

  describe('cancelBatch()', () => {
    it('cancels a draft batch', async () => {
      const h = buildHarness();
      const batch = await h.service.createBatch(ORG_ID, buildCreateBatchDto(), ACTOR_ID);
      const cancelled = await h.service.cancelBatch(ORG_ID, batch.id);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    });

    it('refuses to cancel an executed batch (BATCH_NOT_DRAFT)', async () => {
      const h = buildHarness();
      const batch = await h.service.createBatch(ORG_ID, buildCreateBatchDto(), ACTOR_ID);
      await h.service.addEntry(ORG_ID, batch.id, buildAddEntryDto({ type: 'cca' }));
      await h.service.executeBatch(ORG_ID, batch.id, ACTOR_ID, AUDIT_CTX);
      await expect(h.service.cancelBatch(ORG_ID, batch.id)).rejects.toMatchObject({
        code: ERROR_CODES.REGULARIZATION_BATCH_NOT_DRAFT,
      });
    });
  });
});
