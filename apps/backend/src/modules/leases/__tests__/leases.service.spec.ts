import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import type { EntriesService } from '../../journals/services/entries.service';
import { type CreateLeaseDto } from '../dto/create-lease.dto';
import type { LeaseEntity } from '../entities/lease.entity';
import type { LeaseInstallmentEntity } from '../entities/lease-installment.entity';
import type { LeasePaymentEntity } from '../entities/lease-payment.entity';
import type { LeaseInstallmentsRepository } from '../repositories/lease-installments.repository';
import type { LeasePaymentsRepository } from '../repositories/lease-payments.repository';
import type { LeasesRepository } from '../repositories/leases.repository';
import { LeasesService } from '../services/leases.service';

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

interface DraftCall {
  organizationId: string;
  journalCode: string;
  lines: Array<{ accountCode: string; debit: number; credit: number }>;
  totalDebit: number;
  totalCredit: number;
}

interface Harness {
  service: LeasesService;
  leasesRepo: jest.Mocked<LeasesRepository>;
  installmentsRepo: jest.Mocked<LeaseInstallmentsRepository>;
  paymentsRepo: jest.Mocked<LeasePaymentsRepository>;
  entries: jest.Mocked<EntriesService>;
  storedLeases: LeaseEntity[];
  storedInstallments: LeaseInstallmentEntity[];
  storedPayments: LeasePaymentEntity[];
  createDraftCalls: DraftCall[];
}

function buildHarness(): Harness {
  const storedLeases: LeaseEntity[] = [];
  const storedInstallments: LeaseInstallmentEntity[] = [];
  const storedPayments: LeasePaymentEntity[] = [];
  const createDraftCalls: DraftCall[] = [];
  let leaseCounter = 0;
  let installmentCounter = 0;
  let paymentCounter = 0;
  let entryCounter = 0;

  const leasesRepo = {
    create: jest.fn(async (input) => {
      const lease: LeaseEntity = {
        id: `lease-${++leaseCounter}`,
        organizationId: String(input.organizationId),
        assetId: input.assetId ?? null,
        contractRef: input.contractRef,
        lessorName: input.lessorName,
        startDate: input.startDate,
        endDate: input.endDate,
        fairValue: input.fairValue,
        nominalTotalAmount: input.nominalTotalAmount,
        implicitRate: input.implicitRate,
        purchaseOptionAmount: input.purchaseOptionAmount,
        frequency: input.frequency,
        numberOfInstallments: input.numberOfInstallments,
        status: input.status ?? 'active',
        journalEntryIdInitial: null,
        note: input.note ?? null,
        createdById: input.createdById ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        organization: undefined as never,
      };
      storedLeases.push(lease);
      return lease;
    }),
    findById: jest.fn(async (id: string, organizationId: string) => {
      return (
        storedLeases.find((l) => l.id === id && l.organizationId === String(organizationId)) ?? null
      );
    }),
    listByOrganization: jest.fn(async (organizationId: string, filters = {}) => {
      return storedLeases.filter((l) => {
        if (l.organizationId !== String(organizationId)) return false;
        if (filters.status && l.status !== filters.status) return false;
        if (filters.assetId && l.assetId !== filters.assetId) return false;
        return true;
      });
    }),
    update: jest.fn(async (id: string, organizationId: string, patch) => {
      const idx = storedLeases.findIndex(
        (l) => l.id === id && l.organizationId === String(organizationId),
      );
      if (idx < 0) throw new Error(`Lease ${id} not found in mock store`);
      const updated: LeaseEntity = {
        ...storedLeases[idx],
        ...patch,
        updatedAt: new Date(),
      } as LeaseEntity;
      storedLeases[idx] = updated;
      return updated;
    }),
  } as unknown as jest.Mocked<LeasesRepository>;

  const installmentsRepo = {
    createMany: jest.fn(async (inputs) => {
      const created = inputs.map(
        (input: {
          leaseId: string;
          organizationId: string;
          dueDate: string;
          installmentNumber: number;
          totalAmount: string;
          interestPart: string;
          capitalPart: string;
          outstandingBalance: string;
        }) => {
          const installment: LeaseInstallmentEntity = {
            id: `inst-${++installmentCounter}`,
            leaseId: input.leaseId,
            organizationId: String(input.organizationId),
            dueDate: input.dueDate,
            installmentNumber: input.installmentNumber,
            totalAmount: input.totalAmount,
            interestPart: input.interestPart,
            capitalPart: input.capitalPart,
            outstandingBalance: input.outstandingBalance,
            paid: false,
            createdAt: new Date(),
            lease: undefined as never,
            organization: undefined as never,
          };
          storedInstallments.push(installment);
          return installment;
        },
      );
      return created;
    }),
    findById: jest.fn(async (id: string, organizationId: string) => {
      return (
        storedInstallments.find(
          (i) => i.id === id && i.organizationId === String(organizationId),
        ) ?? null
      );
    }),
    listByLease: jest.fn(async (leaseId: string, organizationId: string) => {
      return storedInstallments
        .filter((i) => i.leaseId === leaseId && i.organizationId === String(organizationId))
        .sort((a, b) => a.installmentNumber - b.installmentNumber);
    }),
    markPaid: jest.fn(async (id: string, organizationId: string) => {
      const idx = storedInstallments.findIndex(
        (i) => i.id === id && i.organizationId === String(organizationId),
      );
      if (idx < 0) throw new Error(`Installment ${id} not found in mock store`);
      storedInstallments[idx] = { ...storedInstallments[idx], paid: true };
      return storedInstallments[idx];
    }),
  } as unknown as jest.Mocked<LeaseInstallmentsRepository>;

  const paymentsRepo = {
    create: jest.fn(async (input) => {
      const payment: LeasePaymentEntity = {
        id: `pay-${++paymentCounter}`,
        leaseId: input.leaseId,
        installmentId: input.installmentId,
        organizationId: String(input.organizationId),
        paymentDate: input.paymentDate,
        amount: input.amount,
        interestPart: input.interestPart,
        capitalPart: input.capitalPart,
        journalEntryId: input.journalEntryId ?? null,
        note: input.note ?? null,
        createdById: input.createdById ?? null,
        createdAt: new Date(),
        lease: undefined as never,
        installment: undefined as never,
        organization: undefined as never,
      };
      storedPayments.push(payment);
      return payment;
    }),
    listByLease: jest.fn(async (leaseId: string, organizationId: string) => {
      return storedPayments.filter(
        (p) => p.leaseId === leaseId && p.organizationId === String(organizationId),
      );
    }),
  } as unknown as jest.Mocked<LeasePaymentsRepository>;

  const entries = {
    createDraft: jest.fn(
      async (
        organizationId: string,
        input: {
          journalCode: string;
          entryDate: string;
          description: string;
          lines: Array<{ accountCode: string; debit: number; credit: number }>;
        },
      ) => {
        const totalDebit = input.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
        const totalCredit = input.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
        createDraftCalls.push({
          organizationId: String(organizationId),
          journalCode: input.journalCode,
          lines: input.lines,
          totalDebit,
          totalCredit,
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
      },
    ),
  } as unknown as jest.Mocked<EntriesService>;

  const service = new LeasesService(leasesRepo, installmentsRepo, paymentsRepo, entries);

  return {
    service,
    leasesRepo,
    installmentsRepo,
    paymentsRepo,
    entries,
    storedLeases,
    storedInstallments,
    storedPayments,
    createDraftCalls,
  };
}

function buildCreateDto(overrides: Partial<CreateLeaseDto> = {}): CreateLeaseDto {
  return {
    contractRef: 'CB-2026-001',
    lessorName: 'Société Générale Leasing',
    startDate: '2026-01-15',
    endDate: '2030-01-15',
    fairValue: '100000.00',
    installmentAmount: '2500.00',
    purchaseOptionAmount: '1000.00',
    frequency: 'monthly',
    numberOfInstallments: 48,
    ...overrides,
  } as CreateLeaseDto;
}

describe('LeasesService', () => {
  describe('create()', () => {
    it('persists lease + 48 installments + posts balanced initial entry D 2411 / C 173', async () => {
      const h = buildHarness();
      const dto = buildCreateDto();

      const result = await h.service.create(ORG_ID, dto, ACTOR_ID, AUDIT_CTX);

      expect(result.lease.status).toBe('active');
      expect(result.lease.organizationId).toBe(String(ORG_ID));
      expect(Number(result.lease.implicitRate)).toBeGreaterThan(0.08);
      expect(Number(result.lease.implicitRate)).toBeLessThan(0.11);
      expect(result.installments).toHaveLength(48);

      // Écriture initiale équilibrée.
      expect(h.entries.createDraft).toHaveBeenCalledTimes(1);
      const call = h.createDraftCalls[0];
      expect(call.totalDebit).toBeCloseTo(call.totalCredit, 2);
      expect(call.totalDebit).toBeCloseTo(100000, 2);

      // Lignes : D 2411 / C 173.
      const debitLine = call.lines.find((l) => l.debit > 0);
      const creditLine = call.lines.find((l) => l.credit > 0);
      expect(debitLine?.accountCode).toBe('2411');
      expect(creditLine?.accountCode).toBe('173');

      // Lease lié à l'écriture initiale.
      expect(result.lease.journalEntryIdInitial).toBe('entry-1');
    });

    it('refuses a non-positive fair value', async () => {
      const h = buildHarness();
      await expect(
        h.service.create(ORG_ID, buildCreateDto({ fairValue: '0' }), ACTOR_ID, AUDIT_CTX),
      ).rejects.toMatchObject({
        code: ERROR_CODES.LEASE_IMPLICIT_RATE_CALCULATION_FAILED,
      });
      expect(h.storedLeases).toHaveLength(0);
      expect(h.entries.createDraft).not.toHaveBeenCalled();
    });
  });

  describe('payInstallment()', () => {
    it('posts D 6724 + D 173 / C 521 with the correct decomposition and marks the installment paid', async () => {
      const h = buildHarness();
      const { lease, installments } = await h.service.create(
        ORG_ID,
        buildCreateDto(),
        ACTOR_ID,
        AUDIT_CTX,
      );
      const firstInstallment = installments[0];

      const initialCallCount = h.entries.createDraft.mock.calls.length;
      const result = await h.service.payInstallment(
        ORG_ID,
        lease.id,
        firstInstallment.id,
        '2026-02-15',
        ACTOR_ID,
        AUDIT_CTX,
      );

      expect(result.installment.paid).toBe(true);
      expect(result.payment.leaseId).toBe(lease.id);
      expect(result.payment.installmentId).toBe(firstInstallment.id);

      // Une seconde écriture (la première était l'écriture initiale).
      expect(h.entries.createDraft.mock.calls.length).toBe(initialCallCount + 1);
      const call = h.createDraftCalls[h.createDraftCalls.length - 1];
      expect(call.totalDebit).toBeCloseTo(call.totalCredit, 2);

      // Au moins une ligne D 173 (capital) et une ligne C 521 (banque).
      const debit173 = call.lines.find((l) => l.accountCode === '173' && l.debit > 0);
      const credit521 = call.lines.find((l) => l.accountCode === '521' && l.credit > 0);
      const debit6724 = call.lines.find((l) => l.accountCode === '6724' && l.debit > 0);
      expect(debit173).toBeDefined();
      expect(credit521).toBeDefined();
      expect(debit6724).toBeDefined();

      // La décomposition correspond à l'amortissement.
      expect(debit173!.debit).toBeCloseTo(Number(firstInstallment.capitalPart), 2);
      expect(debit6724!.debit).toBeCloseTo(Number(firstInstallment.interestPart), 2);
      expect(credit521!.credit).toBeCloseTo(Number(firstInstallment.totalAmount), 2);
    });

    it('refuses a double payment on the same installment (LEASE_INSTALLMENT_ALREADY_PAID)', async () => {
      const h = buildHarness();
      const { lease, installments } = await h.service.create(
        ORG_ID,
        buildCreateDto(),
        ACTOR_ID,
        AUDIT_CTX,
      );
      const first = installments[0];

      await h.service.payInstallment(ORG_ID, lease.id, first.id, '2026-02-15', ACTOR_ID, AUDIT_CTX);
      await expect(
        h.service.payInstallment(ORG_ID, lease.id, first.id, '2026-03-15', ACTOR_ID, AUDIT_CTX),
      ).rejects.toMatchObject({
        code: ERROR_CODES.LEASE_INSTALLMENT_ALREADY_PAID,
      });
    });

    it('refuses payment on a cancelled lease (LEASE_NOT_ACTIVE)', async () => {
      const h = buildHarness();
      const { lease, installments } = await h.service.create(
        ORG_ID,
        buildCreateDto(),
        ACTOR_ID,
        AUDIT_CTX,
      );
      await h.service.cancel(ORG_ID, lease.id);

      await expect(
        h.service.payInstallment(
          ORG_ID,
          lease.id,
          installments[0].id,
          '2026-02-15',
          ACTOR_ID,
          AUDIT_CTX,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.LEASE_NOT_ACTIVE });
    });

    it('raises LEASE_INSTALLMENT_NOT_FOUND when the installment id does not match', async () => {
      const h = buildHarness();
      const { lease } = await h.service.create(ORG_ID, buildCreateDto(), ACTOR_ID, AUDIT_CTX);
      await expect(
        h.service.payInstallment(
          ORG_ID,
          lease.id,
          'nonexistent-installment',
          '2026-02-15',
          ACTOR_ID,
          AUDIT_CTX,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.LEASE_INSTALLMENT_NOT_FOUND });
    });
  });

  describe('tenant isolation', () => {
    it('does not return a lease created by another org', async () => {
      const h = buildHarness();
      const { lease } = await h.service.create(ORG_ID, buildCreateDto(), ACTOR_ID, AUDIT_CTX);

      await expect(h.service.findById(OTHER_ORG_ID, lease.id)).rejects.toMatchObject({
        code: ERROR_CODES.LEASE_NOT_FOUND,
      });
    });
  });

  describe('cancel()', () => {
    it('refuses to cancel a lease that already has payments', async () => {
      const h = buildHarness();
      const { lease, installments } = await h.service.create(
        ORG_ID,
        buildCreateDto(),
        ACTOR_ID,
        AUDIT_CTX,
      );
      await h.service.payInstallment(
        ORG_ID,
        lease.id,
        installments[0].id,
        '2026-02-15',
        ACTOR_ID,
        AUDIT_CTX,
      );
      await expect(h.service.cancel(ORG_ID, lease.id)).rejects.toMatchObject({
        code: ERROR_CODES.LEASE_NOT_ACTIVE,
      });
    });
  });
});
