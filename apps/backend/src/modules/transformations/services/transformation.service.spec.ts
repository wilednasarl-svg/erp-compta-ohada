import type { Repository } from 'typeorm';

import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AuditTrailService, AuditContext } from '../../audit/services/audit-trail.service';
import type { ImportStagingEntryEntity } from '../../imports/entities/import-staging-entry.entity';
import type { EntryTransformationEntity } from '../entities/entry-transformation.entity';
import type { EntryTransformationRepository } from '../repositories/entry-transformation.repository';
import { TransformationService } from './transformation.service';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ORG_ID = asTenantId('org-00000000-0000-0000-0000-000000000001');
const ACTOR_ID = 'user-00000000-0000-0000-0000-000000000001';
const ENTRY_ID = 'entry-00000000-0000-0000-0000-000000000001';

const CTX: AuditContext = {
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
  userId: ACTOR_ID,
  organizationId: ORG_ID,
  requestId: 'req-test',
};

function buildStagingEntry(overrides?: Partial<ImportStagingEntryEntity>): ImportStagingEntryEntity {
  return {
    id: ENTRY_ID,
    sessionId: 'session-1',
    fileId: 'file-1',
    rowNumber: 1,
    rawValues: { compte: '4111', journal: 'VTE', libelle: 'Facture client' },
    mappedValues: { account: '4111', journal: 'VTE', label: 'Facture client' },
    errors: [],
    createdAt: new Date('2026-01-01'),
    ...overrides,
  } as unknown as ImportStagingEntryEntity;
}

function buildTransformationEntity(
  overrides?: Partial<EntryTransformationEntity>,
): EntryTransformationEntity {
  return {
    id: 'trf-00000000-0000-0000-0000-000000000001',
    organizationId: ORG_ID,
    sourceEntryId: ENTRY_ID,
    type: 'reclassification',
    status: 'active',
    beforeValues: {},
    afterValues: {},
    notes: null,
    createdById: ACTOR_ID,
    createdAt: new Date('2026-01-02'),
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
    ...overrides,
  } as unknown as EntryTransformationEntity;
}

// ---------------------------------------------------------------------------
// Mock builders
// ---------------------------------------------------------------------------

function buildStagingRepo(
  entry: ImportStagingEntryEntity | null,
): Pick<Repository<ImportStagingEntryEntity>, 'createQueryBuilder'> {
  const getOne = jest.fn().mockResolvedValue(entry);
  const andWhere = jest.fn().mockReturnThis();
  const where = jest.fn().mockReturnValue({ andWhere, getOne });
  const innerJoin = jest.fn().mockReturnValue({ where });
  return {
    createQueryBuilder: jest.fn().mockReturnValue({ innerJoin }),
  } as unknown as Pick<Repository<ImportStagingEntryEntity>, 'createQueryBuilder'>;
}

function buildTransformationRepo(
  created?: EntryTransformationEntity,
  history?: EntryTransformationEntity[],
): Partial<EntryTransformationRepository> {
  return {
    create: jest.fn().mockResolvedValue(created ?? buildTransformationEntity()),
    findBySourceEntry: jest.fn().mockResolvedValue(history ?? []),
    findById: jest.fn().mockResolvedValue(null),
  };
}

function buildAudit(): Partial<AuditTrailService> {
  return { record: jest.fn().mockResolvedValue(null) };
}

function buildService(
  stagingEntry: ImportStagingEntryEntity | null = buildStagingEntry(),
  created?: EntryTransformationEntity,
  history?: EntryTransformationEntity[],
): {
  service: TransformationService;
  transformationRepo: Partial<EntryTransformationRepository>;
  stagingRepo: Pick<Repository<ImportStagingEntryEntity>, 'createQueryBuilder'>;
  audit: Partial<AuditTrailService>;
} {
  const stagingRepo = buildStagingRepo(stagingEntry);
  const transformationRepo = buildTransformationRepo(created, history);
  const audit = buildAudit();

  const service = new TransformationService(
    transformationRepo as EntryTransformationRepository,
    stagingRepo as unknown as Repository<ImportStagingEntryEntity>,
    audit as AuditTrailService,
  );

  return { service, transformationRepo, stagingRepo, audit };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TransformationService', () => {
  // -------------------------------------------------------------------------
  // reclassifyEntry
  // -------------------------------------------------------------------------

  describe('reclassifyEntry', () => {
    it('creates a reclassification with correct before/after when account changes', async () => {
      const created = buildTransformationEntity({
        type: 'reclassification',
        beforeValues: { account: '4111' },
        afterValues: { account: '4112' },
      });
      const { service, transformationRepo, audit } = buildService(buildStagingEntry(), created);

      const result = await service.reclassifyEntry(
        ORG_ID,
        ACTOR_ID,
        { sourceEntryId: ENTRY_ID, account: '4112' },
        CTX,
      );

      expect(transformationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          sourceEntryId: ENTRY_ID,
          type: 'reclassification',
          beforeValues: { account: '4111' },
          afterValues: { account: '4112' },
        }),
      );
      expect(result.type).toBe('reclassification');
      expect(result.afterValues.account).toBe('4112');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'transformations',
          action: 'entry_reclassified',
          entityId: created.id,
        }),
      );
    });

    it('captures multiple fields in a single reclassification', async () => {
      const { service, transformationRepo } = buildService();

      await service.reclassifyEntry(
        ORG_ID,
        ACTOR_ID,
        { sourceEntryId: ENTRY_ID, account: '4112', journal: 'ACH', label: 'Corrigé' },
        CTX,
      );

      expect(transformationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          beforeValues: { account: '4111', journal: 'VTE', label: 'Facture client' },
          afterValues: { account: '4112', journal: 'ACH', label: 'Corrigé' },
        }),
      );
    });

    it('throws TRANSFORMATION_NO_FIELD_CHANGED when no fields are provided', async () => {
      const { service } = buildService();

      await expect(
        service.reclassifyEntry(ORG_ID, ACTOR_ID, { sourceEntryId: ENTRY_ID }, CTX),
      ).rejects.toMatchObject({
        code: ERROR_CODES.TRANSFORMATION_NO_FIELD_CHANGED,
      });
    });

    it('throws TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND for unknown / cross-tenant entry', async () => {
      const { service } = buildService(null /* staging entry not found */);

      await expect(
        service.reclassifyEntry(
          ORG_ID,
          ACTOR_ID,
          { sourceEntryId: 'unknown-entry', account: '4112' },
          CTX,
        ),
      ).rejects.toMatchObject({
        code: ERROR_CODES.TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND,
      });
    });

    it('stores notes on the transformation when provided', async () => {
      const { service, transformationRepo } = buildService();

      await service.reclassifyEntry(
        ORG_ID,
        ACTOR_ID,
        { sourceEntryId: ENTRY_ID, account: '4112', notes: 'Correction TVA' },
        CTX,
      );

      expect(transformationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ notes: 'Correction TVA' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // adjustEntry
  // -------------------------------------------------------------------------

  describe('adjustEntry', () => {
    it('creates an adjustment with debit amount', async () => {
      const created = buildTransformationEntity({
        type: 'adjustment',
        beforeValues: {},
        afterValues: { adjustmentDebit: '500.00', adjustmentLabel: 'Régularisation' },
      });
      const { service, transformationRepo, audit } = buildService(buildStagingEntry(), created);

      const result = await service.adjustEntry(
        ORG_ID,
        ACTOR_ID,
        {
          sourceEntryId: ENTRY_ID,
          adjustmentDebit: '500.00',
          adjustmentLabel: 'Régularisation',
        },
        CTX,
      );

      expect(transformationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'adjustment',
          beforeValues: {},
          afterValues: expect.objectContaining({
            adjustmentDebit: '500.00',
            adjustmentLabel: 'Régularisation',
          }),
        }),
      );
      expect(result.type).toBe('adjustment');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'transformations',
          action: 'entry_adjusted',
        }),
      );
    });

    it('throws TRANSFORMATION_ADJUSTMENT_INVALID when both debit and credit are provided', async () => {
      const { service } = buildService();

      await expect(
        service.adjustEntry(
          ORG_ID,
          ACTOR_ID,
          {
            sourceEntryId: ENTRY_ID,
            adjustmentDebit: '500.00',
            adjustmentCredit: '500.00',
            adjustmentLabel: 'Invalid',
          },
          CTX,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.TRANSFORMATION_ADJUSTMENT_INVALID });
    });

    it('throws TRANSFORMATION_ADJUSTMENT_INVALID when neither debit nor credit is provided', async () => {
      const { service } = buildService();

      await expect(
        service.adjustEntry(
          ORG_ID,
          ACTOR_ID,
          {
            sourceEntryId: ENTRY_ID,
            adjustmentLabel: 'Missing amount',
          },
          CTX,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.TRANSFORMATION_ADJUSTMENT_INVALID });
    });
  });

  // -------------------------------------------------------------------------
  // getEntryHistory
  // -------------------------------------------------------------------------

  describe('getEntryHistory', () => {
    it('returns transformations ordered by the repo (oldest first)', async () => {
      const t1 = buildTransformationEntity({
        id: 'trf-1',
        createdAt: new Date('2026-01-01'),
        type: 'reclassification',
      });
      const t2 = buildTransformationEntity({
        id: 'trf-2',
        createdAt: new Date('2026-01-03'),
        type: 'adjustment',
        status: 'cancelled',
        cancelledAt: new Date('2026-01-04'),
      });
      const { service } = buildService(buildStagingEntry(), undefined, [t1, t2]);

      const result = await service.getEntryHistory(ORG_ID, ENTRY_ID);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('trf-1');
      expect(result[1].id).toBe('trf-2');
      // Cancelled transformations are included (undo/redo trail).
      expect(result[1].status).toBe('cancelled');
    });

    it('returns empty array when entry has no transformations', async () => {
      const { service } = buildService(buildStagingEntry(), undefined, []);

      const result = await service.getEntryHistory(ORG_ID, ENTRY_ID);

      expect(result).toEqual([]);
    });

    it('throws TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND for cross-tenant entryId', async () => {
      const { service } = buildService(null);

      await expect(
        service.getEntryHistory(ORG_ID, 'foreign-entry'),
      ).rejects.toMatchObject({ code: ERROR_CODES.TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND });
    });
  });
});
