import type { DataSource, EntityManager } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext, AuditTrailService } from '../../audit/services/audit-trail.service';
import type { EntriesService, EntryView } from '../../journals/services/entries.service';
import { TvaDeclarationEntity } from '../entities/tva-declaration.entity';
import { TvaDeclarationLineEntity } from '../entities/tva-declaration-line.entity';
import type { TvaDeclarationRepository } from '../repositories/tva-declaration.repository';
import type {
  TvaAggregationRepository,
  TvaAggregationRow,
} from '../repositories/tva-aggregation.repository';
import { TvaDeclarationsService } from './tva-declarations.service';

const ORG_ID = asTenantId('00000000-0000-4000-a000-000000000001');
const USER_ID = 'u-123';
const CTX: AuditContext = {
  ipAddress: '127.0.0.1',
  userAgent: 'Jest',
  userId: USER_ID,
  organizationId: ORG_ID,
};

describe('TvaDeclarationsService Unit Tests (Module 13)', () => {
  let service: TvaDeclarationsService;
  let mockDataSource: DataSource;
  let mockEntityManager: EntityManager;
  let mockTvaDeclarationRepo: TvaDeclarationRepository;
  let mockTvaAggregationRepo: TvaAggregationRepository;
  let mockAudit: AuditTrailService;
  let mockEntriesService: EntriesService;

  let activeDeclaration: TvaDeclarationEntity | null = null;
  let aggregationRows: TvaAggregationRow[] = [];

  // Mock repositories inside transaction manager
  const mockDeclRepoInTx = {
    create: jest.fn().mockImplementation((dto: Partial<TvaDeclarationEntity>) => ({
      ...dto,
      id: 'decl-new-uuid',
    })),
    save: jest.fn().mockImplementation((decl: TvaDeclarationEntity) => Promise.resolve(decl)),
  };

  const mockLineRepoInTx = {
    save: jest.fn().mockImplementation((lines: TvaDeclarationLineEntity[]) =>
      Promise.resolve(
        lines.map((line, index) => ({
          ...line,
          id: `line-uuid-${index}`,
        })),
      ),
    ),
  };

  beforeEach(() => {
    activeDeclaration = null;
    aggregationRows = [];

    // Reset mocks for each test
    mockEntityManager = {
      getRepository: jest.fn().mockImplementation((entityClass: { name: string }) => {
        if (entityClass === TvaDeclarationEntity) {
          return mockDeclRepoInTx;
        }
        if (entityClass === TvaDeclarationLineEntity) {
          return mockLineRepoInTx;
        }
        throw new Error(`Unsupported entity class ${entityClass.name} in mock transaction`);
      }),
    } as unknown as EntityManager;

    mockDataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: EntityManager) => Promise<unknown>) => cb(mockEntityManager)),
    } as unknown as DataSource;

    mockTvaDeclarationRepo = {
      findActiveByPeriod: jest.fn().mockImplementation(() => Promise.resolve(activeDeclaration)),
      listByOrganization: jest.fn(),
      findById: jest.fn(),
      save: jest.fn().mockImplementation((decl: TvaDeclarationEntity) => Promise.resolve(decl)),
    } as unknown as TvaDeclarationRepository;

    mockTvaAggregationRepo = {
      aggregateByPrefixes: jest.fn().mockImplementation(() => Promise.resolve(aggregationRows)),
    } as unknown as TvaAggregationRepository;

    mockAudit = {
      record: jest.fn().mockResolvedValue(null),
    } as unknown as AuditTrailService;

    mockEntriesService = {
      createDraft: jest.fn().mockResolvedValue({ id: 'entry-draft-uuid' } as Partial<EntryView>),
      validate: jest
        .fn()
        .mockResolvedValue({ id: 'entry-draft-uuid', status: 'validated' } as Partial<EntryView>),
    } as unknown as EntriesService;

    service = new TvaDeclarationsService(
      mockDataSource,
      mockTvaDeclarationRepo,
      mockTvaAggregationRepo,
      mockAudit,
      mockEntriesService,
    );
  });

  // 1. Positive Due
  it('calculates positive due declaration correctly when collected VAT is greater than deductible', async () => {
    aggregationRows = [
      {
        accountPrefix: '443',
        accountLabel: 'TVA Collectée',
        totalDebit: '100.00',
        totalCredit: '1000.00', // Net = 900.00 collected
      },
      {
        accountPrefix: '4452',
        accountLabel: 'TVA déductible BS 1',
        totalDebit: '400.00',
        totalCredit: '100.00', // Net = 300.00 deductible
      },
      {
        accountPrefix: '4451',
        accountLabel: 'TVA déductible immo',
        totalDebit: '250.00',
        totalCredit: '50.00', // Net = 200.00 deductible
      },
    ];

    const decl = await service.computeDeclaration(
      ORG_ID,
      { periodYear: 2026, periodMonth: 5 },
      USER_ID,
      CTX,
    );

    expect(decl.status).toBe('calculated');
    expect(decl.tvaCollecteeTotal).toBe('900.00');
    expect(decl.tvaDeductibleBsTotal).toBe('300.00');
    expect(decl.tvaDeductibleImmoTotal).toBe('200.00');
    expect(decl.tvaADecaisser).toBe('400.00'); // 900 - (300 + 200) = 400
    expect(decl.creditTvaReportable).toBe('0.00');
    expect(decl.lines).toHaveLength(3);
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'declaration_computed' }),
    );
  });

  // 2. Credit TVA (negative due)
  it('calculates credit VAT declaration correctly when deductible VAT is greater than collected', async () => {
    aggregationRows = [
      {
        accountPrefix: '443',
        accountLabel: 'TVA Collectée',
        totalDebit: '0.00',
        totalCredit: '500.00', // Net = 500.00 collected
      },
      {
        accountPrefix: '4452',
        accountLabel: 'TVA déductible BS 1',
        totalDebit: '600.00',
        totalCredit: '0.00', // Net = 600.00 deductible
      },
      {
        accountPrefix: '4451',
        accountLabel: 'TVA déductible immo',
        totalDebit: '200.00',
        totalCredit: '0.00', // Net = 200.00 deductible
      },
    ];

    const decl = await service.computeDeclaration(
      ORG_ID,
      { periodYear: 2026, periodMonth: 5 },
      USER_ID,
      CTX,
    );

    expect(decl.status).toBe('calculated');
    expect(decl.tvaCollecteeTotal).toBe('500.00');
    expect(decl.tvaDeductibleBsTotal).toBe('600.00');
    expect(decl.tvaDeductibleImmoTotal).toBe('200.00');
    expect(decl.tvaADecaisser).toBe('0.00');
    expect(decl.creditTvaReportable).toBe('300.00'); // (600 + 200) - 500 = 300
    expect(decl.lines).toHaveLength(3);
  });

  // 3. Empty Period
  it('handles empty period with no journal entries gracefully returning zero totals', async () => {
    aggregationRows = []; // Empty period

    const decl = await service.computeDeclaration(
      ORG_ID,
      { periodYear: 2026, periodMonth: 5 },
      USER_ID,
      CTX,
    );

    expect(decl.status).toBe('calculated');
    expect(decl.tvaCollecteeTotal).toBe('0.00');
    expect(decl.tvaDeductibleBsTotal).toBe('0.00');
    expect(decl.tvaDeductibleImmoTotal).toBe('0.00');
    expect(decl.tvaADecaisser).toBe('0.00');
    expect(decl.creditTvaReportable).toBe('0.00');
    expect(decl.lines).toHaveLength(0);
  });

  // 4. Multi-codes / multiple prefixes
  it('aggregates multiple prefixes of deductible BS correctly (4452, 4453, 4454, 4455)', async () => {
    aggregationRows = [
      {
        accountPrefix: '443',
        accountLabel: 'TVA Collectée',
        totalDebit: '0.00',
        totalCredit: '200.00', // Net = 200
      },
      {
        accountPrefix: '4452',
        accountLabel: 'Deductible 4452',
        totalDebit: '100.00',
        totalCredit: '0.00', // Net = 100
      },
      {
        accountPrefix: '4453',
        accountLabel: 'Deductible 4453',
        totalDebit: '50.00',
        totalCredit: '0.00', // Net = 50
      },
      {
        accountPrefix: '4454',
        accountLabel: 'Deductible 4454',
        totalDebit: '30.00',
        totalCredit: '0.00', // Net = 30
      },
      {
        accountPrefix: '4455',
        accountLabel: 'Deductible 4455',
        totalDebit: '20.00',
        totalCredit: '0.00', // Net = 20
      },
    ];

    const decl = await service.computeDeclaration(
      ORG_ID,
      { periodYear: 2026, periodMonth: 5 },
      USER_ID,
      CTX,
    );

    expect(decl.tvaCollecteeTotal).toBe('200.00');
    expect(decl.tvaDeductibleBsTotal).toBe('200.00'); // 100 + 50 + 30 + 20 = 200
    expect(decl.tvaDeductibleImmoTotal).toBe('0.00');
    expect(decl.tvaADecaisser).toBe('0.00');
    expect(decl.creditTvaReportable).toBe('0.00');
    expect(decl.lines).toHaveLength(5);
  });

  // 5. Validation error on period
  it('throws validation error if period year or month is out of valid ranges', async () => {
    let err1: unknown;
    try {
      await service.computeDeclaration(ORG_ID, { periodYear: 2026, periodMonth: 13 }, USER_ID, CTX);
    } catch (e) {
      err1 = e;
    }
    expect(err1).toBeInstanceOf(AppException);
    expect((err1 as AppException).code).toBe(ERROR_CODES.TVA_DECLARATION_INVALID_PERIOD);

    let err2: unknown;
    try {
      await service.computeDeclaration(ORG_ID, { periodYear: 1999, periodMonth: 5 }, USER_ID, CTX);
    } catch (e) {
      err2 = e;
    }
    expect(err2).toBeInstanceOf(AppException);
    expect((err2 as AppException).code).toBe(ERROR_CODES.TVA_DECLARATION_INVALID_PERIOD);
  });

  // 6. Already exists error
  it('throws an error if an active (non-cancelled) declaration already exists for this period', async () => {
    activeDeclaration = {
      id: 'existing-decl-uuid',
      status: 'calculated',
    } as unknown as TvaDeclarationEntity;

    let err: unknown;
    try {
      await service.computeDeclaration(ORG_ID, { periodYear: 2026, periodMonth: 5 }, USER_ID, CTX);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe(ERROR_CODES.TVA_DECLARATION_ALREADY_EXISTS);
  });

  // 7. Cancellation logic
  it('successfully cancels a calculated declaration', async () => {
    const decl = {
      id: 'decl-to-cancel',
      organizationId: ORG_ID,
      status: 'calculated',
    } as unknown as TvaDeclarationEntity;

    jest.spyOn(mockTvaDeclarationRepo, 'findById').mockResolvedValue(decl);

    const cancelled = await service.cancelDeclaration(
      'decl-to-cancel',
      ORG_ID,
      { reason: 'Duplicate entry correction' },
      USER_ID,
      CTX,
    );

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelledById).toBe(USER_ID);
    expect(cancelled.cancelledReason).toBe('Duplicate entry correction');
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'declaration_cancelled' }),
    );
  });

  it('fails to cancel a declaration if it is not in calculated status', async () => {
    const decl = {
      id: 'decl-already-cancelled',
      organizationId: ORG_ID,
      status: 'cancelled',
    } as unknown as TvaDeclarationEntity;

    jest.spyOn(mockTvaDeclarationRepo, 'findById').mockResolvedValue(decl);

    let err: unknown;
    try {
      await service.cancelDeclaration('decl-already-cancelled', ORG_ID, {}, USER_ID, CTX);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe(ERROR_CODES.TVA_DECLARATION_NOT_CALCULATED);
  });

  it("refuse d'annuler une déclaration centralisée (W4.1)", async () => {
    const decl = {
      id: 'decl-centralized',
      organizationId: ORG_ID,
      status: 'calculated',
      centralizationJournalEntryId: 'entry-uuid',
      centralizedAt: new Date(),
    } as unknown as TvaDeclarationEntity;

    jest.spyOn(mockTvaDeclarationRepo, 'findById').mockResolvedValue(decl);

    let err: unknown;
    try {
      await service.cancelDeclaration('decl-centralized', ORG_ID, {}, USER_ID, CTX);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe(ERROR_CODES.TVA_DECLARATION_CENTRALIZED_CANNOT_CANCEL);
    // Aucun update : la déclaration reste calculated.
    expect(mockTvaDeclarationRepo.save).not.toHaveBeenCalled();
  });

  // ─── W4.1 — Centralisation TVA ─────────────────────────────────────
  describe('centralize() — W4.1', () => {
    function buildCalculatedDeclaration(overrides: Partial<TvaDeclarationEntity> = {}) {
      return {
        id: 'decl-to-centralize',
        organizationId: ORG_ID,
        periodYear: 2026,
        periodMonth: 5,
        status: 'calculated',
        tvaCollecteeTotal: '900.00',
        tvaDeductibleBsTotal: '300.00',
        tvaDeductibleImmoTotal: '200.00',
        tvaADecaisser: '400.00',
        creditTvaReportable: '0.00',
        centralizationJournalEntryId: null,
        centralizedAt: null,
        ...overrides,
      } as unknown as TvaDeclarationEntity;
    }

    it('génère une écriture équilibrée pour une déclaration calculated (TVA due)', async () => {
      const decl = buildCalculatedDeclaration();
      jest.spyOn(mockTvaDeclarationRepo, 'findById').mockResolvedValue(decl);

      const result = await service.centralize(ORG_ID, 'decl-to-centralize', USER_ID, CTX);

      expect(mockEntriesService.createDraft).toHaveBeenCalledTimes(1);
      const draftArgs = (mockEntriesService.createDraft as jest.Mock).mock.calls[0];
      expect(draftArgs[0]).toBe(ORG_ID);
      expect(draftArgs[1].journalCode).toBe('OD');
      expect(draftArgs[1].entryDate).toBe('2026-05-31');
      expect(draftArgs[1].sourceType).toBe('tax_centralization');

      const lines = draftArgs[1].lines as Array<{
        accountCode: string;
        debit: number;
        credit: number;
      }>;

      // D 443 = 900 ; C 4451 = 200 ; C 4452 = 300 ; C 4441 = 400.
      const byAccount = Object.fromEntries(
        lines.map((l) => [l.accountCode, { debit: l.debit, credit: l.credit }]),
      );
      expect(byAccount['443']).toEqual({ debit: 900, credit: 0 });
      expect(byAccount['4451']).toEqual({ debit: 0, credit: 200 });
      expect(byAccount['4452']).toEqual({ debit: 0, credit: 300 });
      expect(byAccount['4441']).toEqual({ debit: 0, credit: 400 });

      const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(900);

      // L'écriture est laissée en draft : le comptable la valide via journals/.
      expect(mockEntriesService.validate).not.toHaveBeenCalled();

      expect(result.declaration.centralizationJournalEntryId).toBe('entry-draft-uuid');
      expect(result.declaration.centralizedAt).toBeInstanceOf(Date);
      expect(result.journalEntry.id).toBe('entry-draft-uuid');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'declaration_centralized' }),
      );
    });

    it('génère une écriture avec D 4449 pour un crédit reportable', async () => {
      const decl = buildCalculatedDeclaration({
        tvaCollecteeTotal: '500.00',
        tvaDeductibleBsTotal: '600.00',
        tvaDeductibleImmoTotal: '200.00',
        tvaADecaisser: '0.00',
        creditTvaReportable: '300.00',
      });
      jest.spyOn(mockTvaDeclarationRepo, 'findById').mockResolvedValue(decl);

      await service.centralize(ORG_ID, 'decl-to-centralize', USER_ID, CTX);

      const draftArgs = (mockEntriesService.createDraft as jest.Mock).mock.calls[0];
      const lines = draftArgs[1].lines as Array<{
        accountCode: string;
        debit: number;
        credit: number;
      }>;

      const byAccount = Object.fromEntries(
        lines.map((l) => [l.accountCode, { debit: l.debit, credit: l.credit }]),
      );
      expect(byAccount['443']).toEqual({ debit: 500, credit: 0 });
      expect(byAccount['4451']).toEqual({ debit: 0, credit: 200 });
      expect(byAccount['4452']).toEqual({ debit: 0, credit: 600 });
      expect(byAccount['4449']).toEqual({ debit: 300, credit: 0 });
      expect(byAccount['4441']).toBeUndefined();

      const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(800);
    });

    it('rejette une déclaration non calculée avec TVA_DECLARATION_NOT_CALCULATED', async () => {
      const decl = buildCalculatedDeclaration({ status: 'draft' });
      jest.spyOn(mockTvaDeclarationRepo, 'findById').mockResolvedValue(decl);

      let err: unknown;
      try {
        await service.centralize(ORG_ID, 'decl-to-centralize', USER_ID, CTX);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).code).toBe(ERROR_CODES.TVA_DECLARATION_NOT_CALCULATED);
      expect(mockEntriesService.createDraft).not.toHaveBeenCalled();
    });

    it('rejette une déclaration déjà centralisée avec TVA_ALREADY_CENTRALIZED', async () => {
      const decl = buildCalculatedDeclaration({
        centralizationJournalEntryId: 'existing-entry-uuid',
        centralizedAt: new Date('2026-05-31T23:59:00Z'),
      });
      jest.spyOn(mockTvaDeclarationRepo, 'findById').mockResolvedValue(decl);

      let err: unknown;
      try {
        await service.centralize(ORG_ID, 'decl-to-centralize', USER_ID, CTX);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).code).toBe(ERROR_CODES.TVA_ALREADY_CENTRALIZED);
      expect(mockEntriesService.createDraft).not.toHaveBeenCalled();
    });

    it('rejette une période vide (aucun mouvement TVA) avec JOURNAL_ENTRY_EMPTY_LINES', async () => {
      const decl = buildCalculatedDeclaration({
        tvaCollecteeTotal: '0.00',
        tvaDeductibleBsTotal: '0.00',
        tvaDeductibleImmoTotal: '0.00',
        tvaADecaisser: '0.00',
        creditTvaReportable: '0.00',
      });
      jest.spyOn(mockTvaDeclarationRepo, 'findById').mockResolvedValue(decl);

      let err: unknown;
      try {
        await service.centralize(ORG_ID, 'decl-to-centralize', USER_ID, CTX);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).code).toBe(ERROR_CODES.JOURNAL_ENTRY_EMPTY_LINES);
      expect(mockEntriesService.createDraft).not.toHaveBeenCalled();
    });

    it("respecte l'isolation tenant : retourne TVA_DECLARATION_NOT_FOUND si la déclaration n'appartient pas à l'org", async () => {
      jest.spyOn(mockTvaDeclarationRepo, 'findById').mockResolvedValue(null);

      let err: unknown;
      try {
        await service.centralize(ORG_ID, 'decl-from-other-tenant', USER_ID, CTX);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).code).toBe(ERROR_CODES.TVA_DECLARATION_NOT_FOUND);
      expect(mockEntriesService.createDraft).not.toHaveBeenCalled();
    });
  });
});
