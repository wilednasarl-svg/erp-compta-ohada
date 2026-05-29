import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import type { EntriesService } from '../../journals/services/entries.service';
import { type CreateBillDto } from '../dto/create-bill.dto';
import { type DiscountBillDto } from '../dto/discount-bill.dto';
import { type SettleBillDto } from '../dto/settle-bill.dto';
import type { BillEventEntity } from '../entities/bill-event.entity';
import type { BillOfExchangeEntity } from '../entities/bill-of-exchange.entity';
import type { BillEventsRepository } from '../repositories/bill-events.repository';
import type { BillsOfExchangeRepository } from '../repositories/bills-of-exchange.repository';
import { BillsOfExchangeService } from '../services/bills-of-exchange.service';

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

interface CapturedLine {
  accountCode: string;
  debit: number;
  credit: number;
}

interface CapturedCall {
  organizationId: string;
  journalCode: string;
  entryDate: string;
  lines: CapturedLine[];
}

interface Harness {
  service: BillsOfExchangeService;
  billsRepo: jest.Mocked<BillsOfExchangeRepository>;
  eventsRepo: jest.Mocked<BillEventsRepository>;
  entries: jest.Mocked<EntriesService>;
  storedBills: BillOfExchangeEntity[];
  storedEvents: BillEventEntity[];
  createDraftCalls: CapturedCall[];
}

function buildHarness(): Harness {
  const storedBills: BillOfExchangeEntity[] = [];
  const storedEvents: BillEventEntity[] = [];
  const createDraftCalls: CapturedCall[] = [];
  let billCounter = 0;
  let eventCounter = 0;
  let entryCounter = 0;

  const billsRepo = {
    create: jest.fn(async (input) => {
      const bill: BillOfExchangeEntity = {
        id: `bill-${++billCounter}`,
        organizationId: String(input.organizationId),
        kind: input.kind,
        partnerAccountCode: input.partnerAccountCode,
        partnerName: input.partnerName,
        billNumber: input.billNumber,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        nominalAmount: input.nominalAmount,
        status: input.status,
        currentLocationAccount: input.currentLocationAccount,
        originalJournalEntryId: input.originalJournalEntryId ?? null,
        note: input.note ?? null,
        createdById: input.createdById ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        organization: undefined as never,
      };
      storedBills.push(bill);
      return bill;
    }),
    findById: jest.fn(async (id: string, organizationId: string) => {
      return (
        storedBills.find((b) => b.id === id && b.organizationId === String(organizationId)) ?? null
      );
    }),
    listByOrganization: jest.fn(async (organizationId: string, filters = {}) => {
      return storedBills.filter((b) => {
        if (b.organizationId !== String(organizationId)) return false;
        if (filters.kind && b.kind !== filters.kind) return false;
        if (filters.status && b.status !== filters.status) return false;
        if (filters.dueBefore && b.dueDate > filters.dueBefore) return false;
        return true;
      });
    }),
    update: jest.fn(async (id: string, organizationId: string, patch) => {
      const idx = storedBills.findIndex(
        (b) => b.id === id && b.organizationId === String(organizationId),
      );
      if (idx < 0) throw new Error(`Bill ${id} not found in mock store`);
      const updated: BillOfExchangeEntity = {
        ...storedBills[idx],
        ...patch,
        updatedAt: new Date(),
      } as BillOfExchangeEntity;
      storedBills[idx] = updated;
      return updated;
    }),
  } as unknown as jest.Mocked<BillsOfExchangeRepository>;

  const eventsRepo = {
    create: jest.fn(async (input) => {
      const event: BillEventEntity = {
        id: `evt-${++eventCounter}`,
        billId: input.billId,
        organizationId: String(input.organizationId),
        eventType: input.eventType,
        eventDate: input.eventDate,
        amount: input.amount,
        discountFee: input.discountFee ?? null,
        bankFee: input.bankFee ?? null,
        netAmount: input.netAmount ?? null,
        journalEntryId: input.journalEntryId ?? null,
        note: input.note ?? null,
        createdById: input.createdById ?? null,
        createdAt: new Date(),
        bill: undefined as never,
        organization: undefined as never,
      };
      storedEvents.push(event);
      return event;
    }),
    listByBill: jest.fn(async (billId: string, organizationId: string) => {
      return storedEvents
        .filter((e) => e.billId === billId && e.organizationId === String(organizationId))
        .sort((a, b) => b.eventDate.localeCompare(a.eventDate));
    }),
  } as unknown as jest.Mocked<BillEventsRepository>;

  const entries = {
    createDraft: jest.fn(async (organizationId, input) => {
      createDraftCalls.push({
        organizationId: String(organizationId),
        journalCode: input.journalCode,
        entryDate: input.entryDate,
        lines: input.lines.map((l: CapturedLine) => ({
          accountCode: l.accountCode,
          debit: l.debit,
          credit: l.credit,
        })),
      });
      return {
        id: `entry-${++entryCounter}`,
        organizationId: String(organizationId),
        journalCode: input.journalCode,
        periodId: 'period-1',
        entryNumber: entryCounter,
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
  } as unknown as jest.Mocked<EntriesService>;

  const service = new BillsOfExchangeService(billsRepo, eventsRepo, entries);

  return {
    service,
    billsRepo,
    eventsRepo,
    entries,
    storedBills,
    storedEvents,
    createDraftCalls,
  };
}

function buildReceivableDto(overrides: Partial<CreateBillDto> = {}): CreateBillDto {
  return {
    kind: 'receivable',
    partnerAccountCode: '4111001',
    partnerName: 'Client Acme',
    billNumber: 'LCR-2026-001',
    issueDate: '2026-03-15',
    dueDate: '2026-06-15',
    nominalAmount: '1000.00',
    ...overrides,
  } as CreateBillDto;
}

function buildPayableDto(overrides: Partial<CreateBillDto> = {}): CreateBillDto {
  return {
    kind: 'payable',
    partnerAccountCode: '4011001',
    partnerName: 'Fournisseur Beta',
    billNumber: 'BAP-2026-001',
    issueDate: '2026-03-15',
    dueDate: '2026-06-15',
    nominalAmount: '2000.00',
    ...overrides,
  } as CreateBillDto;
}

function findLine(call: CapturedCall, accountCode: string): CapturedLine | undefined {
  return call.lines.find((l) => l.accountCode === accountCode);
}

describe('BillsOfExchangeService', () => {
  describe('issue() receivable', () => {
    it('creates an issued bill with D 412 / C 411 and currentLocationAccount=412', async () => {
      const h = buildHarness();
      const dto = buildReceivableDto({ nominalAmount: '1500.00' });

      const bill = await h.service.issue(ORG_ID, dto, ACTOR_ID, AUDIT_CTX);

      expect(bill.status).toBe('issued');
      expect(bill.kind).toBe('receivable');
      expect(bill.currentLocationAccount).toBe('412');
      expect(bill.nominalAmount).toBe('1500.00');
      expect(bill.originalJournalEntryId).toBe('entry-1');

      expect(h.createDraftCalls).toHaveLength(1);
      const call = h.createDraftCalls[0];
      expect(call.organizationId).toBe(String(ORG_ID));
      expect(call.lines).toHaveLength(2);

      const debit = findLine(call, '412');
      const credit = findLine(call, '4111001');
      expect(debit?.debit).toBeCloseTo(1500, 2);
      expect(credit?.credit).toBeCloseTo(1500, 2);

      expect(h.storedEvents).toHaveLength(1);
      expect(h.storedEvents[0].eventType).toBe('issuance');
      expect(h.storedEvents[0].journalEntryId).toBe('entry-1');
    });

    it('rejects a non-positive nominal amount', async () => {
      const h = buildHarness();
      await expect(
        h.service.issue(ORG_ID, buildReceivableDto({ nominalAmount: '0' }), ACTOR_ID, AUDIT_CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.BILL_INVALID_AMOUNT });
      expect(h.entries.createDraft).not.toHaveBeenCalled();
      expect(h.storedBills).toHaveLength(0);
    });
  });

  describe('issue() payable', () => {
    it('creates an issued bill with D 401 / C 402 and currentLocationAccount=402', async () => {
      const h = buildHarness();
      const dto = buildPayableDto({ nominalAmount: '2500.00' });

      const bill = await h.service.issue(ORG_ID, dto, ACTOR_ID, AUDIT_CTX);

      expect(bill.status).toBe('issued');
      expect(bill.kind).toBe('payable');
      expect(bill.currentLocationAccount).toBe('402');

      const call = h.createDraftCalls[0];
      expect(findLine(call, '4011001')?.debit).toBeCloseTo(2500, 2);
      expect(findLine(call, '402')?.credit).toBeCloseTo(2500, 2);
    });
  });

  describe('discount()', () => {
    it('computes netAmount, posts a balanced 4-line entry, transitions to discounted on 415', async () => {
      const h = buildHarness();
      const bill = await h.service.issue(
        ORG_ID,
        buildReceivableDto({ nominalAmount: '1000.00' }),
        ACTOR_ID,
        AUDIT_CTX,
      );

      const dto: DiscountBillDto = {
        eventDate: '2026-04-01',
        discountFee: '30.00',
        bankFee: '10.00',
      };

      const updated = await h.service.discount(ORG_ID, bill.id, dto, ACTOR_ID, AUDIT_CTX);

      expect(updated.status).toBe('discounted');
      expect(updated.currentLocationAccount).toBe('415');

      const call = h.createDraftCalls[1];
      expect(call.lines).toHaveLength(4);
      // Balanced
      const totalDebit = call.lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = call.lines.reduce((s, l) => s + l.credit, 0);
      expect(totalDebit).toBeCloseTo(1000, 2);
      expect(totalCredit).toBeCloseTo(1000, 2);

      expect(findLine(call, '5121')?.debit).toBeCloseTo(960, 2); // 1000 - 30 - 10
      expect(findLine(call, '6745')?.debit).toBeCloseTo(30, 2);
      expect(findLine(call, '6312')?.debit).toBeCloseTo(10, 2);
      expect(findLine(call, '415')?.credit).toBeCloseTo(1000, 2);

      const discountEvent = h.storedEvents.find((e) => e.eventType === 'discount');
      expect(discountEvent?.netAmount).toBe('960.00');
      expect(discountEvent?.discountFee).toBe('30.00');
      expect(discountEvent?.bankFee).toBe('10.00');
    });

    it('rejects discount on a payable (BILL_INVALID_STATE_FOR_ACTION)', async () => {
      const h = buildHarness();
      const bill = await h.service.issue(ORG_ID, buildPayableDto(), ACTOR_ID, AUDIT_CTX);

      await expect(
        h.service.discount(
          ORG_ID,
          bill.id,
          { eventDate: '2026-04-01', discountFee: '10.00', bankFee: '5.00' },
          ACTOR_ID,
          AUDIT_CTX,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.BILL_INVALID_STATE_FOR_ACTION });
    });

    it('rejects discount when fees exceed nominal (BILL_NEGATIVE_NET)', async () => {
      const h = buildHarness();
      const bill = await h.service.issue(
        ORG_ID,
        buildReceivableDto({ nominalAmount: '100.00' }),
        ACTOR_ID,
        AUDIT_CTX,
      );

      await expect(
        h.service.discount(
          ORG_ID,
          bill.id,
          { eventDate: '2026-04-01', discountFee: '80.00', bankFee: '25.00' },
          ACTOR_ID,
          AUDIT_CTX,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.BILL_NEGATIVE_NET });
    });
  });

  describe('settle() receivable', () => {
    it('after issued: posts D 5121 / C 412 and transitions to paid', async () => {
      const h = buildHarness();
      const bill = await h.service.issue(
        ORG_ID,
        buildReceivableDto({ nominalAmount: '800.00' }),
        ACTOR_ID,
        AUDIT_CTX,
      );

      const dto: SettleBillDto = { eventDate: '2026-06-15' };
      const updated = await h.service.settle(ORG_ID, bill.id, dto, ACTOR_ID, AUDIT_CTX);

      expect(updated.status).toBe('paid');
      const call = h.createDraftCalls[1];
      expect(findLine(call, '5121')?.debit).toBeCloseTo(800, 2);
      expect(findLine(call, '412')?.credit).toBeCloseTo(800, 2);

      const paymentEvent = h.storedEvents.find((e) => e.eventType === 'payment');
      expect(paymentEvent).toBeDefined();
    });

    it('after discounted: posts D 415 / C 412 and transitions to paid', async () => {
      const h = buildHarness();
      const bill = await h.service.issue(
        ORG_ID,
        buildReceivableDto({ nominalAmount: '500.00' }),
        ACTOR_ID,
        AUDIT_CTX,
      );
      await h.service.discount(
        ORG_ID,
        bill.id,
        { eventDate: '2026-04-01', discountFee: '15.00', bankFee: '5.00' },
        ACTOR_ID,
        AUDIT_CTX,
      );

      const updated = await h.service.settle(
        ORG_ID,
        bill.id,
        { eventDate: '2026-06-15' },
        ACTOR_ID,
        AUDIT_CTX,
      );

      expect(updated.status).toBe('paid');
      const lastCall = h.createDraftCalls[h.createDraftCalls.length - 1];
      expect(findLine(lastCall, '415')?.debit).toBeCloseTo(500, 2);
      expect(findLine(lastCall, '412')?.credit).toBeCloseTo(500, 2);
    });
  });

  describe('settle() payable', () => {
    it('after issued: posts D 402 / C 5121 and transitions to paid', async () => {
      const h = buildHarness();
      const bill = await h.service.issue(
        ORG_ID,
        buildPayableDto({ nominalAmount: '1200.00' }),
        ACTOR_ID,
        AUDIT_CTX,
      );

      const updated = await h.service.settle(
        ORG_ID,
        bill.id,
        { eventDate: '2026-06-15' },
        ACTOR_ID,
        AUDIT_CTX,
      );

      expect(updated.status).toBe('paid');
      const lastCall = h.createDraftCalls[h.createDraftCalls.length - 1];
      expect(findLine(lastCall, '402')?.debit).toBeCloseTo(1200, 2);
      expect(findLine(lastCall, '5121')?.credit).toBeCloseTo(1200, 2);
    });

    it('rejects settle on already paid (BILL_INVALID_STATE_FOR_ACTION)', async () => {
      const h = buildHarness();
      const bill = await h.service.issue(ORG_ID, buildPayableDto(), ACTOR_ID, AUDIT_CTX);
      await h.service.settle(ORG_ID, bill.id, { eventDate: '2026-06-15' }, ACTOR_ID, AUDIT_CTX);

      await expect(
        h.service.settle(ORG_ID, bill.id, { eventDate: '2026-06-16' }, ACTOR_ID, AUDIT_CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.BILL_INVALID_STATE_FOR_ACTION });
    });
  });

  describe('markUnpaid()', () => {
    it('after issued: posts D 4131 / C 412 and transitions to unpaid', async () => {
      const h = buildHarness();
      const bill = await h.service.issue(
        ORG_ID,
        buildReceivableDto({ nominalAmount: '600.00' }),
        ACTOR_ID,
        AUDIT_CTX,
      );

      const updated = await h.service.markUnpaid(
        ORG_ID,
        bill.id,
        { eventDate: '2026-06-20' },
        ACTOR_ID,
        AUDIT_CTX,
      );

      expect(updated.status).toBe('unpaid');
      const lastCall = h.createDraftCalls[h.createDraftCalls.length - 1];
      expect(findLine(lastCall, '4131')?.debit).toBeCloseTo(600, 2);
      expect(findLine(lastCall, '412')?.credit).toBeCloseTo(600, 2);

      const evt = h.storedEvents.find((e) => e.eventType === 'unpaid_return');
      expect(evt).toBeDefined();
    });

    it('after discounted: posts D 4131 / C 415', async () => {
      const h = buildHarness();
      const bill = await h.service.issue(
        ORG_ID,
        buildReceivableDto({ nominalAmount: '400.00' }),
        ACTOR_ID,
        AUDIT_CTX,
      );
      await h.service.discount(
        ORG_ID,
        bill.id,
        { eventDate: '2026-04-01', discountFee: '12.00', bankFee: '3.00' },
        ACTOR_ID,
        AUDIT_CTX,
      );

      const updated = await h.service.markUnpaid(
        ORG_ID,
        bill.id,
        { eventDate: '2026-06-20' },
        ACTOR_ID,
        AUDIT_CTX,
      );

      expect(updated.status).toBe('unpaid');
      const lastCall = h.createDraftCalls[h.createDraftCalls.length - 1];
      expect(findLine(lastCall, '4131')?.debit).toBeCloseTo(400, 2);
      expect(findLine(lastCall, '415')?.credit).toBeCloseTo(400, 2);
    });

    it('rejects markUnpaid on a payable', async () => {
      const h = buildHarness();
      const bill = await h.service.issue(ORG_ID, buildPayableDto(), ACTOR_ID, AUDIT_CTX);
      await expect(
        h.service.markUnpaid(ORG_ID, bill.id, { eventDate: '2026-06-20' }, ACTOR_ID, AUDIT_CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.BILL_INVALID_STATE_FOR_ACTION });
    });
  });

  describe('findById() tenant isolation', () => {
    it('returns BILL_NOT_FOUND when reading from a different org', async () => {
      const h = buildHarness();
      const bill = await h.service.issue(ORG_ID, buildReceivableDto(), ACTOR_ID, AUDIT_CTX);

      await expect(h.service.findById(OTHER_ORG_ID, bill.id)).rejects.toBeInstanceOf(AppException);
      await expect(h.service.findById(OTHER_ORG_ID, bill.id)).rejects.toMatchObject({
        code: ERROR_CODES.BILL_NOT_FOUND,
      });
    });

    it('returns bill + events when reading from the correct org', async () => {
      const h = buildHarness();
      const bill = await h.service.issue(ORG_ID, buildReceivableDto(), ACTOR_ID, AUDIT_CTX);

      const result = await h.service.findById(ORG_ID, bill.id);
      expect(result.bill.id).toBe(bill.id);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].eventType).toBe('issuance');
    });
  });

  describe('listByOrg()', () => {
    it('filters by kind/status/dueBefore', async () => {
      const h = buildHarness();
      await h.service.issue(
        ORG_ID,
        buildReceivableDto({ billNumber: 'A', dueDate: '2026-06-15' }),
        ACTOR_ID,
        AUDIT_CTX,
      );
      await h.service.issue(
        ORG_ID,
        buildPayableDto({ billNumber: 'B', dueDate: '2026-07-15' }),
        ACTOR_ID,
        AUDIT_CTX,
      );

      const receivables = await h.service.listByOrg(ORG_ID, { kind: 'receivable' });
      expect(receivables).toHaveLength(1);
      expect(receivables[0].kind).toBe('receivable');

      const beforeJuly = await h.service.listByOrg(ORG_ID, { dueBefore: '2026-06-30' });
      expect(beforeJuly).toHaveLength(1);
      expect(beforeJuly[0].billNumber).toBe('A');
    });
  });
});
