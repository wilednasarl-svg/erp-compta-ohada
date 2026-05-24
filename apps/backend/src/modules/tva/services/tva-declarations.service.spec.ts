import { DataSource, EntityManager } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { TvaDeclarationEntity } from '../entities/tva-declaration.entity';
import { TvaDeclarationLineEntity } from '../entities/tva-declaration-line.entity';
import { TvaDeclarationRepository } from '../repositories/tva-declaration.repository';
import { TvaAggregationRepository, type TvaAggregationRow } from '../repositories/tva-aggregation.repository';
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

  let activeDeclaration: TvaDeclarationEntity | null = null;
  let aggregationRows: TvaAggregationRow[] = [];

  // Mock repositories inside transaction manager
  const mockDeclRepoInTx = {
    create: jest.fn().mockImplementation((dto) => ({
      ...dto,
      id: 'decl-new-uuid',
    })),
    save: jest.fn().mockImplementation(async (decl) => decl),
  };

  const mockLineRepoInTx = {
    save: jest.fn().mockImplementation(async (lines) => {
      return lines.map((line: any, index: number) => ({
        ...line,
        id: `line-uuid-${index}`,
      }));
    }),
  };

  beforeEach(() => {
    activeDeclaration = null;
    aggregationRows = [];

    // Reset mocks for each test
    mockEntityManager = {
      getRepository: jest.fn().mockImplementation((entityClass) => {
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
      transaction: jest.fn().mockImplementation(async (cb) => {
        return cb(mockEntityManager);
      }),
    } as unknown as DataSource;

    mockTvaDeclarationRepo = {
      findActiveByPeriod: jest.fn().mockImplementation(async () => activeDeclaration),
      listByOrganization: jest.fn(),
      findById: jest.fn(),
      save: jest.fn().mockImplementation(async (decl) => decl),
    } as unknown as TvaDeclarationRepository;

    mockTvaAggregationRepo = {
      aggregateByPrefixes: jest.fn().mockImplementation(async () => aggregationRows),
    } as unknown as TvaAggregationRepository;

    mockAudit = {
      record: jest.fn().mockResolvedValue(null),
    } as unknown as AuditTrailService;

    service = new TvaDeclarationsService(
      mockDataSource,
      mockTvaDeclarationRepo,
      mockTvaAggregationRepo,
      mockAudit,
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
    let err1: any;
    try {
      await service.computeDeclaration(ORG_ID, { periodYear: 2026, periodMonth: 13 }, USER_ID, CTX);
    } catch (e) {
      err1 = e;
    }
    expect(err1).toBeInstanceOf(AppException);
    expect(err1.code).toBe(ERROR_CODES.TVA_DECLARATION_INVALID_PERIOD);

    let err2: any;
    try {
      await service.computeDeclaration(ORG_ID, { periodYear: 1999, periodMonth: 5 }, USER_ID, CTX);
    } catch (e) {
      err2 = e;
    }
    expect(err2).toBeInstanceOf(AppException);
    expect(err2.code).toBe(ERROR_CODES.TVA_DECLARATION_INVALID_PERIOD);
  });

  // 6. Already exists error
  it('throws an error if an active (non-cancelled) declaration already exists for this period', async () => {
    activeDeclaration = {
      id: 'existing-decl-uuid',
      status: 'calculated',
    } as unknown as TvaDeclarationEntity;

    let err: any;
    try {
      await service.computeDeclaration(ORG_ID, { periodYear: 2026, periodMonth: 5 }, USER_ID, CTX);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppException);
    expect(err.code).toBe(ERROR_CODES.TVA_DECLARATION_ALREADY_EXISTS);
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

    let err: any;
    try {
      await service.cancelDeclaration('decl-already-cancelled', ORG_ID, {}, USER_ID, CTX);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppException);
    expect(err.code).toBe(ERROR_CODES.TVA_DECLARATION_NOT_CALCULATED);
  });
});
