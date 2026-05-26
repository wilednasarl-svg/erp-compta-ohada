import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import type { EntriesService } from '../../journals/services/entries.service';
import { CreateProvisionDto } from '../dto/create-provision.dto';
import type { ProvisionEntity } from '../entities/provision.entity';
import type { ProvisionMovementEntity } from '../entities/provision-movement.entity';
import type { ProvisionMovementsRepository } from '../repositories/provision-movements.repository';
import type { ProvisionsRepository } from '../repositories/provisions.repository';
import { ProvisionsService } from '../services/provisions.service';

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

interface Harness {
  service: ProvisionsService;
  provisionsRepo: jest.Mocked<ProvisionsRepository>;
  movementsRepo: jest.Mocked<ProvisionMovementsRepository>;
  entries: jest.Mocked<EntriesService>;
  storedProvisions: ProvisionEntity[];
  storedMovements: ProvisionMovementEntity[];
  createDraftCalls: Array<{
    organizationId: string;
    journalCode: string;
    debitAccount: string;
    creditAccount: string;
    amount: number;
  }>;
}

function buildHarness(): Harness {
  const storedProvisions: ProvisionEntity[] = [];
  const storedMovements: ProvisionMovementEntity[] = [];
  const createDraftCalls: Harness['createDraftCalls'] = [];
  let provisionCounter = 0;
  let movementCounter = 0;
  let entryCounter = 0;

  const provisionsRepo = {
    create: jest.fn(async (input) => {
      const provision: ProvisionEntity = {
        id: `prov-${++provisionCounter}`,
        organizationId: String(input.organizationId),
        type: input.type,
        accountCode: input.accountCode,
        label: input.label,
        initialAmount: input.initialAmount,
        currentAmount: input.currentAmount,
        status: input.status ?? 'active',
        createdById: input.createdById ?? null,
        closedById: null,
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        organization: undefined as never,
      };
      storedProvisions.push(provision);
      return provision;
    }),
    findById: jest.fn(async (id: string, organizationId: string) => {
      return (
        storedProvisions.find(
          (p) => p.id === id && p.organizationId === String(organizationId),
        ) ?? null
      );
    }),
    listByOrganization: jest.fn(async (organizationId: string, filters = {}) => {
      return storedProvisions.filter((p) => {
        if (p.organizationId !== String(organizationId)) return false;
        if (filters.status && p.status !== filters.status) return false;
        if (filters.type && p.type !== filters.type) return false;
        return true;
      });
    }),
    update: jest.fn(async (id: string, organizationId: string, patch) => {
      const idx = storedProvisions.findIndex(
        (p) => p.id === id && p.organizationId === String(organizationId),
      );
      if (idx < 0) throw new Error(`Provision ${id} not found in mock store`);
      const updated: ProvisionEntity = {
        ...storedProvisions[idx],
        ...patch,
        updatedAt: new Date(),
      } as ProvisionEntity;
      storedProvisions[idx] = updated;
      return updated;
    }),
  } as unknown as jest.Mocked<ProvisionsRepository>;

  const movementsRepo = {
    create: jest.fn(async (input) => {
      const movement: ProvisionMovementEntity = {
        id: `mvt-${++movementCounter}`,
        provisionId: input.provisionId,
        organizationId: String(input.organizationId),
        kind: input.kind,
        amount: input.amount,
        journalEntryId: input.journalEntryId ?? null,
        effectiveDate: input.effectiveDate,
        note: input.note ?? null,
        createdById: input.createdById ?? null,
        createdAt: new Date(),
        provision: undefined as never,
        organization: undefined as never,
      };
      storedMovements.push(movement);
      return movement;
    }),
    listByProvision: jest.fn(async (provisionId: string, organizationId: string) => {
      return storedMovements
        .filter((m) => m.provisionId === provisionId && m.organizationId === String(organizationId))
        .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    }),
  } as unknown as jest.Mocked<ProvisionMovementsRepository>;

  const entries = {
    createDraft: jest.fn(async (organizationId, input) => {
      const debitLine = input.lines.find(
        (l: { debit: number; credit: number }) => l.debit > 0,
      );
      const creditLine = input.lines.find(
        (l: { debit: number; credit: number }) => l.credit > 0,
      );
      createDraftCalls.push({
        organizationId: String(organizationId),
        journalCode: input.journalCode,
        debitAccount: debitLine?.accountCode ?? '',
        creditAccount: creditLine?.accountCode ?? '',
        amount: debitLine?.debit ?? 0,
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

  const service = new ProvisionsService(provisionsRepo, movementsRepo, entries);

  return {
    service,
    provisionsRepo,
    movementsRepo,
    entries,
    storedProvisions,
    storedMovements,
    createDraftCalls,
  };
}

function buildCreateDto(overrides: Partial<CreateProvisionDto> = {}): CreateProvisionDto {
  return {
    type: 'litige',
    label: 'Litige client Acme',
    initialAmount: '1000.00',
    effectiveDate: '2026-03-15',
    ...overrides,
  } as CreateProvisionDto;
}

describe('ProvisionsService', () => {
  describe('create()', () => {
    it('creates an active provision with currentAmount=initialAmount + posts D 6911 / C 191', async () => {
      const h = buildHarness();
      const dto = buildCreateDto({ type: 'litige', initialAmount: '1500.00' });

      const provision = await h.service.create(ORG_ID, dto, ACTOR_ID, AUDIT_CTX);

      expect(provision.status).toBe('active');
      expect(provision.currentAmount).toBe('1500.00');
      expect(provision.initialAmount).toBe('1500.00');
      expect(provision.accountCode).toBe('191');

      expect(h.entries.createDraft).toHaveBeenCalledTimes(1);
      expect(h.createDraftCalls).toHaveLength(1);
      const call = h.createDraftCalls[0];
      expect(call.organizationId).toBe(String(ORG_ID));
      expect(call.debitAccount).toBe('6911'); // dotation litige
      expect(call.creditAccount).toBe('191'); // compte 19x litige
      expect(call.amount).toBeCloseTo(1500, 2);

      // Mouvement initial de dotation persiste
      expect(h.storedMovements).toHaveLength(1);
      expect(h.storedMovements[0].kind).toBe('dotation');
      expect(h.storedMovements[0].journalEntryId).toBe('entry-1');
    });

    it('rejects a non-positive initial amount', async () => {
      const h = buildHarness();
      await expect(
        h.service.create(ORG_ID, buildCreateDto({ initialAmount: '0' }), ACTOR_ID, AUDIT_CTX),
      ).rejects.toMatchObject({
        code: ERROR_CODES.PROVISION_INVALID_AMOUNT,
      });
      expect(h.entries.createDraft).not.toHaveBeenCalled();
      expect(h.storedProvisions).toHaveLength(0);
    });
  });

  describe('dotation()', () => {
    it('increments currentAmount and posts a second entry', async () => {
      const h = buildHarness();
      const provision = await h.service.create(
        ORG_ID,
        buildCreateDto({ initialAmount: '1000.00' }),
        ACTOR_ID,
        AUDIT_CTX,
      );

      const updated = await h.service.dotation(
        ORG_ID,
        provision.id,
        '500.00',
        '2026-04-01',
        ACTOR_ID,
        AUDIT_CTX,
      );

      expect(updated.currentAmount).toBe('1500.00');
      expect(updated.status).toBe('active');
      expect(h.entries.createDraft).toHaveBeenCalledTimes(2);
      expect(h.storedMovements).toHaveLength(2);
      expect(h.storedMovements[1].kind).toBe('dotation');
    });

    it('refuses to dotation a closed provision (PROVISION_NOT_ACTIVE)', async () => {
      const h = buildHarness();
      const provision = await h.service.create(
        ORG_ID,
        buildCreateDto({ initialAmount: '500.00' }),
        ACTOR_ID,
        AUDIT_CTX,
      );
      // Close by full reprise
      await h.service.reprise(
        ORG_ID,
        provision.id,
        '500.00',
        '2026-04-01',
        ACTOR_ID,
        AUDIT_CTX,
      );

      await expect(
        h.service.dotation(ORG_ID, provision.id, '100.00', '2026-04-02', ACTOR_ID, AUDIT_CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.PROVISION_NOT_ACTIVE });
    });
  });

  describe('reprise()', () => {
    it('partial reprise leaves status=active', async () => {
      const h = buildHarness();
      const provision = await h.service.create(
        ORG_ID,
        buildCreateDto({ initialAmount: '1000.00' }),
        ACTOR_ID,
        AUDIT_CTX,
      );

      const updated = await h.service.reprise(
        ORG_ID,
        provision.id,
        '400.00',
        '2026-04-01',
        ACTOR_ID,
        AUDIT_CTX,
      );

      expect(updated.currentAmount).toBe('600.00');
      expect(updated.status).toBe('active');
      expect(updated.closedAt).toBeNull();

      // Sens de l ecriture inverse : D 191 / C 7911
      const lastCall = h.createDraftCalls[h.createDraftCalls.length - 1];
      expect(lastCall.debitAccount).toBe('191');
      expect(lastCall.creditAccount).toBe('7911');

      expect(h.storedMovements[h.storedMovements.length - 1].kind).toBe('reprise');
    });

    it('full reprise switches status to closed and stamps closedAt', async () => {
      const h = buildHarness();
      const provision = await h.service.create(
        ORG_ID,
        buildCreateDto({ initialAmount: '300.00' }),
        ACTOR_ID,
        AUDIT_CTX,
      );

      const updated = await h.service.reprise(
        ORG_ID,
        provision.id,
        '300.00',
        '2026-04-01',
        ACTOR_ID,
        AUDIT_CTX,
      );

      expect(updated.currentAmount).toBe('0.00');
      expect(updated.status).toBe('closed');
      expect(updated.closedAt).toBeInstanceOf(Date);
      expect(updated.closedById).toBe(ACTOR_ID);
    });

    it('refuses to reprise more than currentAmount (PROVISION_INSUFFICIENT_BALANCE)', async () => {
      const h = buildHarness();
      const provision = await h.service.create(
        ORG_ID,
        buildCreateDto({ initialAmount: '200.00' }),
        ACTOR_ID,
        AUDIT_CTX,
      );

      await expect(
        h.service.reprise(ORG_ID, provision.id, '500.00', '2026-04-01', ACTOR_ID, AUDIT_CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.PROVISION_INSUFFICIENT_BALANCE });
    });
  });

  describe('utilization()', () => {
    it('decrements currentAmount WITHOUT calling EntriesService', async () => {
      const h = buildHarness();
      const provision = await h.service.create(
        ORG_ID,
        buildCreateDto({ initialAmount: '800.00' }),
        ACTOR_ID,
        AUDIT_CTX,
      );

      const callsBefore = h.entries.createDraft.mock.calls.length;
      const updated = await h.service.utilization(
        ORG_ID,
        provision.id,
        '300.00',
        '2026-04-10',
        ACTOR_ID,
      );

      expect(updated.currentAmount).toBe('500.00');
      expect(updated.status).toBe('active');
      // No additional entry posted on utilization
      expect(h.entries.createDraft.mock.calls.length).toBe(callsBefore);

      const lastMvt = h.storedMovements[h.storedMovements.length - 1];
      expect(lastMvt.kind).toBe('utilization');
      expect(lastMvt.journalEntryId).toBeNull();
    });
  });

  describe('findById() tenant isolation', () => {
    it('returns PROVISION_NOT_FOUND when reading from a different org', async () => {
      const h = buildHarness();
      const provision = await h.service.create(
        ORG_ID,
        buildCreateDto({ initialAmount: '100.00' }),
        ACTOR_ID,
        AUDIT_CTX,
      );

      await expect(h.service.findById(OTHER_ORG_ID, provision.id)).rejects.toBeInstanceOf(
        AppException,
      );
      await expect(h.service.findById(OTHER_ORG_ID, provision.id)).rejects.toMatchObject({
        code: ERROR_CODES.PROVISION_NOT_FOUND,
      });
    });

    it('returns provision + movements when reading from the correct org', async () => {
      const h = buildHarness();
      const provision = await h.service.create(
        ORG_ID,
        buildCreateDto({ initialAmount: '100.00' }),
        ACTOR_ID,
        AUDIT_CTX,
      );

      const result = await h.service.findById(ORG_ID, provision.id);
      expect(result.provision.id).toBe(provision.id);
      expect(result.movements).toHaveLength(1);
      expect(result.movements[0].kind).toBe('dotation');
    });
  });
});
