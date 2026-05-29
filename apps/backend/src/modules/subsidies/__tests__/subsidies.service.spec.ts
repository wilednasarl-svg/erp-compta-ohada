import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import type { DepreciationScheduleEntity } from '../../assets/entities/depreciation-schedule.entity';
import type { DepreciationSchedulesRepository } from '../../assets/repositories/depreciation-schedules.repository';
import type { EntriesService } from '../../journals/services/entries.service';
import type { SubsidyEntity } from '../entities/subsidy.entity';
import type { SubsidyReleaseEntity } from '../entities/subsidy-release.entity';
import type {
  CreateSubsidyInput,
  SubsidiesRepository,
  UpdateSubsidyInput,
} from '../repositories/subsidies.repository';
import type {
  CreateSubsidyReleaseInput,
  SubsidyReleasesRepository,
} from '../repositories/subsidy-releases.repository';
import { SubsidiesService } from '../services/subsidies.service';

const ORG_ID = asTenantId('11111111-1111-1111-1111-111111111111');
const OTHER_ORG_ID = asTenantId('99999999-9999-9999-9999-999999999999');
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const CTX: AuditContext = {
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

interface Harness {
  service: SubsidiesService;
  subsidiesRepo: {
    create: jest.Mock;
    findById: jest.Mock;
    listByOrganization: jest.Mock;
    update: jest.Mock;
  };
  releasesRepo: {
    create: jest.Mock;
    listBySubsidy: jest.Mock;
  };
  schedulesRepo: { findById: jest.Mock };
  entries: { createDraft: jest.Mock; validate: jest.Mock };
  storedSubsidies: SubsidyEntity[];
  storedReleases: SubsidyReleaseEntity[];
}

function buildHarness(): Harness {
  const storedSubsidies: SubsidyEntity[] = [];
  const storedReleases: SubsidyReleaseEntity[] = [];
  let subsidyCounter = 0;
  let releaseCounter = 0;
  let entryCounter = 0;

  const subsidiesRepo = {
    create: jest.fn(async (input: CreateSubsidyInput) => {
      const row: SubsidyEntity = {
        id: `subs-${++subsidyCounter}`,
        organizationId: String(input.organizationId),
        assetId: input.assetId ?? null,
        grantorName: input.grantorName,
        grantDate: input.grantDate,
        totalAmount: input.totalAmount,
        releasedAmount: '0.00',
        releaseMethod: input.releaseMethod,
        status: 'active',
        journalEntryIdGrant: input.journalEntryIdGrant ?? null,
        note: input.note ?? null,
        createdById: input.createdById ?? null,
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        asset: null,
        organization: undefined as never,
      };
      storedSubsidies.push(row);
      return row;
    }),
    findById: jest.fn(
      async (id: string, organizationId: string) =>
        storedSubsidies.find((s) => s.id === id && s.organizationId === String(organizationId)) ??
        null,
    ),
    listByOrganization: jest.fn(async (organizationId: string, filters = {}) =>
      storedSubsidies.filter((s) => {
        if (s.organizationId !== String(organizationId)) return false;
        const f = filters as { status?: string; assetId?: string };
        if (f.status && s.status !== f.status) return false;
        if (f.assetId && s.assetId !== f.assetId) return false;
        return true;
      }),
    ),
    update: jest.fn(async (id: string, organizationId: string, patch: UpdateSubsidyInput) => {
      const idx = storedSubsidies.findIndex(
        (s) => s.id === id && s.organizationId === String(organizationId),
      );
      if (idx < 0) throw new Error(`Subsidy ${id} not found in mock store`);
      const updated: SubsidyEntity = {
        ...storedSubsidies[idx],
        ...patch,
        updatedAt: new Date(),
      } as SubsidyEntity;
      storedSubsidies[idx] = updated;
      return updated;
    }),
  };

  const releasesRepo = {
    create: jest.fn(async (input: CreateSubsidyReleaseInput) => {
      const row: SubsidyReleaseEntity = {
        id: `rel-${++releaseCounter}`,
        subsidyId: input.subsidyId,
        organizationId: String(input.organizationId),
        releaseDate: input.releaseDate,
        amount: input.amount,
        journalEntryId: input.journalEntryId ?? null,
        relatedDepreciationScheduleId: input.relatedDepreciationScheduleId ?? null,
        createdById: input.createdById ?? null,
        createdAt: new Date(),
        subsidy: undefined as never,
        organization: undefined as never,
      };
      storedReleases.push(row);
      return row;
    }),
    listBySubsidy: jest.fn(async (subsidyId: string, organizationId: string) =>
      storedReleases.filter(
        (r) => r.subsidyId === subsidyId && r.organizationId === String(organizationId),
      ),
    ),
  };

  const schedulesRepo = {
    findById: jest.fn<Promise<DepreciationScheduleEntity | null>, [string, string]>(),
  };

  const entries = {
    createDraft: jest.fn(async () => ({ id: `je-${++entryCounter}` })),
    validate: jest.fn(async () => undefined),
  };

  const service = new SubsidiesService(
    subsidiesRepo as unknown as SubsidiesRepository,
    releasesRepo as unknown as SubsidyReleasesRepository,
    schedulesRepo as unknown as DepreciationSchedulesRepository,
    entries as unknown as EntriesService,
  );

  return {
    service,
    subsidiesRepo,
    releasesRepo,
    schedulesRepo,
    entries,
    storedSubsidies,
    storedReleases,
  };
}

describe('SubsidiesService (W4.4)', () => {
  describe('create — octroi', () => {
    it('posts D 4494 100k / C 1411 100k and persists active subsidy', async () => {
      const h = buildHarness();

      const subsidy = await h.service.create(
        ORG_ID,
        {
          grantorName: 'État de Côte d Ivoire',
          grantDate: '2025-01-15',
          totalAmount: '100000.00',
          releaseMethod: 'on_depreciation',
          assetId: 'asset-1',
        },
        ACTOR_ID,
        CTX,
      );

      expect(subsidy.status).toBe('active');
      expect(subsidy.totalAmount).toBe('100000.00');
      expect(subsidy.releasedAmount).toBe('0.00');
      expect(subsidy.assetId).toBe('asset-1');
      expect(subsidy.journalEntryIdGrant).toBe('je-1');

      expect(h.entries.createDraft).toHaveBeenCalledTimes(1);
      const draftCall = h.entries.createDraft.mock.calls[0];
      expect(draftCall[0]).toBe(ORG_ID);
      const entryInput = draftCall[1];
      expect(entryInput.lines).toEqual([
        expect.objectContaining({ accountCode: '4494', debit: 100000, credit: 0 }),
        expect.objectContaining({ accountCode: '1411', debit: 0, credit: 100000 }),
      ]);
    });

    it('uses grantDebitAccount override (e.g. 521 banque)', async () => {
      const h = buildHarness();

      await h.service.create(
        ORG_ID,
        {
          grantorName: 'Bailleur X',
          grantDate: '2025-01-15',
          totalAmount: '50000.00',
          releaseMethod: 'manual',
          grantDebitAccount: '521',
        },
        ACTOR_ID,
        CTX,
      );

      const entryInput = h.entries.createDraft.mock.calls[0][1];
      expect(entryInput.lines[0].accountCode).toBe('521');
      expect(entryInput.lines[1].accountCode).toBe('1411');
    });

    it('rejects SUBSIDY_INVALID_AMOUNT for totalAmount <= 0', async () => {
      const h = buildHarness();
      await expect(
        h.service.create(
          ORG_ID,
          {
            grantorName: 'X',
            grantDate: '2025-01-15',
            totalAmount: '0',
            releaseMethod: 'manual',
          },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toMatchObject({
        code: ERROR_CODES.SUBSIDY_INVALID_AMOUNT,
        status: 422,
      });
    });
  });

  describe('releaseManual', () => {
    async function seedManual(h: Harness, total = '100000.00'): Promise<SubsidyEntity> {
      return h.service.create(
        ORG_ID,
        {
          grantorName: 'Bailleur Y',
          grantDate: '2025-01-15',
          totalAmount: total,
          releaseMethod: 'manual',
        },
        ACTOR_ID,
        CTX,
      );
    }

    it('posts D 1411 5k / C 799 5k and bumps releasedAmount to 5000', async () => {
      const h = buildHarness();
      const subsidy = await seedManual(h);
      h.entries.createDraft.mockClear();

      const release = await h.service.releaseManual(
        ORG_ID,
        subsidy.id,
        { amount: '5000.00', releaseDate: '2025-06-30' },
        ACTOR_ID,
        CTX,
      );

      expect(release.amount).toBe('5000.00');
      expect(release.journalEntryId).toMatch(/^je-/);
      expect(release.relatedDepreciationScheduleId).toBeNull();

      const entryInput = h.entries.createDraft.mock.calls[0][1];
      expect(entryInput.lines).toEqual([
        expect.objectContaining({ accountCode: '1411', debit: 5000, credit: 0 }),
        expect.objectContaining({ accountCode: '799', debit: 0, credit: 5000 }),
      ]);

      const reloaded = h.storedSubsidies.find((s) => s.id === subsidy.id);
      expect(reloaded?.releasedAmount).toBe('5000.00');
      expect(reloaded?.status).toBe('active');
    });

    it('flips status to fully_released when releasedAmount reaches totalAmount', async () => {
      const h = buildHarness();
      const subsidy = await seedManual(h, '10000.00');

      await h.service.releaseManual(
        ORG_ID,
        subsidy.id,
        { amount: '7000.00', releaseDate: '2025-06-30' },
        ACTOR_ID,
        CTX,
      );
      const finalRelease = await h.service.releaseManual(
        ORG_ID,
        subsidy.id,
        { amount: '3000.00', releaseDate: '2025-12-31' },
        ACTOR_ID,
        CTX,
      );

      expect(finalRelease.amount).toBe('3000.00');
      const reloaded = h.storedSubsidies.find((s) => s.id === subsidy.id);
      expect(reloaded?.releasedAmount).toBe('10000.00');
      expect(reloaded?.status).toBe('fully_released');
      expect(reloaded?.closedAt).toBeInstanceOf(Date);
    });

    it('throws SUBSIDY_OVERRELEASE when amount > remaining', async () => {
      const h = buildHarness();
      const subsidy = await seedManual(h, '10000.00');
      await h.service.releaseManual(
        ORG_ID,
        subsidy.id,
        { amount: '8000.00', releaseDate: '2025-06-30' },
        ACTOR_ID,
        CTX,
      );

      await expect(
        h.service.releaseManual(
          ORG_ID,
          subsidy.id,
          { amount: '3000.00', releaseDate: '2025-12-31' },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toMatchObject({
        code: ERROR_CODES.SUBSIDY_OVERRELEASE,
        status: 422,
      });
    });

    it('rejects releaseManual when subsidy method != manual (SUBSIDY_INVALID_AMOUNT)', async () => {
      const h = buildHarness();
      const subsidy = await h.service.create(
        ORG_ID,
        {
          grantorName: 'X',
          grantDate: '2025-01-15',
          totalAmount: '10000.00',
          releaseMethod: 'linear_10y',
        },
        ACTOR_ID,
        CTX,
      );

      await expect(
        h.service.releaseManual(
          ORG_ID,
          subsidy.id,
          { amount: '100.00', releaseDate: '2025-06-30' },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toBeInstanceOf(AppException);
    });

    it('throws SUBSIDY_NOT_FOUND for unknown subsidy', async () => {
      const h = buildHarness();
      await expect(
        h.service.releaseManual(
          ORG_ID,
          'subs-missing',
          { amount: '100.00', releaseDate: '2025-06-30' },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toMatchObject({
        code: ERROR_CODES.SUBSIDY_NOT_FOUND,
        status: 404,
      });
    });
  });

  describe('releaseOnDepreciation', () => {
    function buildSchedule(
      overrides: Partial<DepreciationScheduleEntity> = {},
    ): DepreciationScheduleEntity {
      return {
        id: 'sched-1',
        organizationId: ORG_ID,
        assetId: 'asset-1',
        fiscalYear: 2025,
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31',
        depreciationAmount: '10000.00',
        cumulativeDepreciation: '10000.00',
        netBookValue: '90000.00',
        status: 'posted',
        journalEntryId: 'je-dep',
        postedAt: new Date(),
        postedById: ACTOR_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      } as DepreciationScheduleEntity;
    }

    it('derives share = totalAmount × dotation / acquisitionCost (100k × 10k / 100k = 10k)', async () => {
      const h = buildHarness();
      const subsidy = await h.service.create(
        ORG_ID,
        {
          grantorName: 'État',
          grantDate: '2025-01-15',
          totalAmount: '100000.00',
          releaseMethod: 'on_depreciation',
          assetId: 'asset-1',
        },
        ACTOR_ID,
        CTX,
      );
      h.entries.createDraft.mockClear();
      h.schedulesRepo.findById.mockResolvedValue(buildSchedule());

      const release = await h.service.releaseOnDepreciation(
        ORG_ID,
        subsidy.id,
        'sched-1',
        ACTOR_ID,
        CTX,
      );

      expect(release.amount).toBe('10000.00');
      expect(release.relatedDepreciationScheduleId).toBe('sched-1');
      const entryInput = h.entries.createDraft.mock.calls[0][1];
      expect(entryInput.lines).toEqual([
        expect.objectContaining({ accountCode: '1411', debit: 10000, credit: 0 }),
        expect.objectContaining({ accountCode: '799', debit: 0, credit: 10000 }),
      ]);

      const reloaded = h.storedSubsidies.find((s) => s.id === subsidy.id);
      expect(reloaded?.releasedAmount).toBe('10000.00');
    });
  });

  describe('cancel', () => {
    it('marks an unused active subsidy as cancelled', async () => {
      const h = buildHarness();
      const subsidy = await h.service.create(
        ORG_ID,
        {
          grantorName: 'X',
          grantDate: '2025-01-15',
          totalAmount: '5000.00',
          releaseMethod: 'manual',
        },
        ACTOR_ID,
        CTX,
      );

      const cancelled = await h.service.cancel(ORG_ID, subsidy.id, ACTOR_ID);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.closedAt).toBeInstanceOf(Date);
    });

    it('refuses cancellation once releases exist (SUBSIDY_NOT_ACTIVE)', async () => {
      const h = buildHarness();
      const subsidy = await h.service.create(
        ORG_ID,
        {
          grantorName: 'X',
          grantDate: '2025-01-15',
          totalAmount: '5000.00',
          releaseMethod: 'manual',
        },
        ACTOR_ID,
        CTX,
      );
      await h.service.releaseManual(
        ORG_ID,
        subsidy.id,
        { amount: '1000.00', releaseDate: '2025-06-30' },
        ACTOR_ID,
        CTX,
      );

      await expect(h.service.cancel(ORG_ID, subsidy.id, ACTOR_ID)).rejects.toMatchObject({
        code: ERROR_CODES.SUBSIDY_NOT_ACTIVE,
        status: 409,
      });
    });
  });

  describe('tenant isolation', () => {
    it('findById in another org throws SUBSIDY_NOT_FOUND', async () => {
      const h = buildHarness();
      const subsidy = await h.service.create(
        ORG_ID,
        {
          grantorName: 'X',
          grantDate: '2025-01-15',
          totalAmount: '5000.00',
          releaseMethod: 'manual',
        },
        ACTOR_ID,
        CTX,
      );

      await expect(h.service.findById(OTHER_ORG_ID, subsidy.id)).rejects.toMatchObject({
        code: ERROR_CODES.SUBSIDY_NOT_FOUND,
      });
    });

    it('listByOrg only returns rows scoped to the calling org', async () => {
      const h = buildHarness();
      await h.service.create(
        ORG_ID,
        {
          grantorName: 'A',
          grantDate: '2025-01-15',
          totalAmount: '1000.00',
          releaseMethod: 'manual',
        },
        ACTOR_ID,
        CTX,
      );

      const orgRows = await h.service.listByOrg(ORG_ID);
      const otherRows = await h.service.listByOrg(OTHER_ORG_ID);

      expect(orgRows.length).toBe(1);
      expect(otherRows.length).toBe(0);
    });
  });
});
