import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { AccountingPeriodEntity } from '../../journals/entities/accounting-period.entity';
import type { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import type { AuditTrailService } from '../../audit/services/audit-trail.service';
import type { AccountingScoreEntity } from '../entities/accounting-score.entity';
import type { AccountingScoreRepository } from '../repositories/accounting-score.repository';
import { AccountingScoreService } from '../services/accounting-score.service';
import { asTenantId } from '../../../common/persistence/tenant-scope';

const ORG_ID = asTenantId('00000000-0000-0000-0000-0000000000aa');
const EXERCISE_ID = '00000000-0000-0000-0000-0000000000ee';
const ACTOR_ID = '00000000-0000-0000-0000-0000000000ac';

interface QueryResponseMap {
  validatedEntries: { total: string };
  anomalies: { total: string; weighted: string | null };
  missing: { total: string; without: string };
  bank: { total: string; unmatched: string };
}

/**
 * Stub minimal de DataSource.query qui route sur le bon dataset selon
 * la table mentionnée dans le SQL — évite de mocker l'ORM entier.
 */
function makeDataSource(map: {
  validatedEntries?: QueryResponseMap['validatedEntries'];
  anomalies?: QueryResponseMap['anomalies'] | Error;
  missing?: QueryResponseMap['missing'];
  bank?: QueryResponseMap['bank'] | Error;
}): DataSource {
  return {
    query: jest.fn((sql: string) => {
      if (sql.includes('FROM ai_anomalies')) {
        if (map.anomalies instanceof Error) return Promise.reject(map.anomalies);
        return Promise.resolve([map.anomalies ?? { total: '0', weighted: '0' }]);
      }
      if (sql.includes('FROM bank_statement_lines')) {
        if (map.bank instanceof Error) return Promise.reject(map.bank);
        return Promise.resolve([map.bank ?? { total: '0', unmatched: '0' }]);
      }
      if (sql.includes('WITH significant AS')) {
        return Promise.resolve([map.missing ?? { total: '0', without: '0' }]);
      }
      if (sql.includes('FROM journal_entries')) {
        return Promise.resolve([map.validatedEntries ?? { total: '0' }]);
      }
      return Promise.resolve([]);
    }),
  } as unknown as DataSource;
}

function makePeriodRepo(period: AccountingPeriodEntity | null): AccountingPeriodRepository {
  return {
    findById: jest.fn(() => Promise.resolve(period)),
  } as unknown as AccountingPeriodRepository;
}

function makeScoreRepo(): AccountingScoreRepository {
  return {
    insert: jest.fn((input) =>
      Promise.resolve({
        id: '00000000-0000-0000-0000-0000000000s1',
        organizationId: input.organizationId,
        exerciseId: input.exerciseId,
        score: input.score,
        grade: input.grade,
        breakdown: input.breakdown,
        calculatedAt: new Date('2026-05-25T10:00:00Z'),
        calculatedBy: input.calculatedBy ?? 'heuristic_v1',
      }),
    ) as unknown as AccountingScoreRepository['insert'],
    findLatest: jest.fn(),
  } as unknown as AccountingScoreRepository;
}

function makeAudit(): AuditTrailService {
  return {
    record: jest.fn(() => Promise.resolve(null)),
  } as unknown as AuditTrailService;
}

function makePeriod(overrides: Partial<AccountingPeriodEntity> = {}): AccountingPeriodEntity {
  return {
    id: EXERCISE_ID,
    organizationId: ORG_ID,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    status: 'open',
    kind: 'ANNUAL',
    label: 'Exercice 2026',
    ...overrides,
  } as unknown as AccountingPeriodEntity;
}

describe('AccountingScoreService', () => {
  beforeAll(() => {
    // Silence le logger Nest pendant les tests.
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  describe('recalculate', () => {
    it('produit un grade A et persiste sur un exercice propre', async () => {
      const period = makePeriod({ status: 'closed' });
      const ds = makeDataSource({
        validatedEntries: { total: '200' },
        anomalies: { total: '0', weighted: '0' },
        missing: { total: '50', without: '0' },
        bank: { total: '120', unmatched: '0' },
      });
      const periodRepo = makePeriodRepo(period);
      const scoreRepo = makeScoreRepo();
      const audit = makeAudit();

      const service = new AccountingScoreService(ds, periodRepo, scoreRepo, audit);
      const { entity, result } = await service.recalculate({
        organizationId: ORG_ID,
        exerciseId: EXERCISE_ID,
        actorId: ACTOR_ID,
        ctx: { ipAddress: '127.0.0.1', userAgent: 'jest' },
        referenceDate: '2026-05-25',
      });

      expect(result.score).toBe(100);
      expect(result.grade).toBe('A');
      expect(entity.score).toBe(100);
      expect(scoreRepo.insert).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'accounting_score',
          action: 'score_recalculated',
          entityType: 'accounting_period',
          entityId: EXERCISE_ID,
        }),
      );
    });

    it('produit un grade bas et persiste sur un exercice sale', async () => {
      const period = makePeriod({
        status: 'open',
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      });
      const ds = makeDataSource({
        validatedEntries: { total: '200' },
        // 80 anomalies risk_score moyen 60 → weighted = 4800
        anomalies: { total: '80', weighted: '4800' },
        missing: { total: '50', without: '40' },
        bank: { total: '120', unmatched: '90' },
      });
      const periodRepo = makePeriodRepo(period);
      const scoreRepo = makeScoreRepo();

      const service = new AccountingScoreService(ds, periodRepo, scoreRepo, makeAudit());
      const { result } = await service.recalculate({
        organizationId: ORG_ID,
        exerciseId: EXERCISE_ID,
        actorId: ACTOR_ID,
        ctx: { ipAddress: null, userAgent: null },
        referenceDate: '2026-05-25',
      });

      expect(result.grade).toBe('D');
      expect(result.score).toBeLessThanOrEqual(45);
      expect(result.breakdown.anomalies.raw.anomaliesCount).toBe(80);
      expect(result.breakdown.missing_justification.raw.withoutDocuments).toBe(40);
      expect(result.breakdown.bank_reconciliation.raw.unmatchedLines).toBe(90);
      expect(result.breakdown.workflow_delays.raw.daysOverdue).toBeGreaterThan(120);
    });

    it("tolère l'absence des tables sources (ai_anomalies, bank_statement_lines)", async () => {
      const period = makePeriod({ status: 'closed' });
      const ds = makeDataSource({
        validatedEntries: { total: '100' },
        anomalies: new Error('relation "ai_anomalies" does not exist'),
        missing: { total: '20', without: '0' },
        bank: new Error('relation "bank_statement_lines" does not exist'),
      });

      const service = new AccountingScoreService(
        ds,
        makePeriodRepo(period),
        makeScoreRepo(),
        makeAudit(),
      );
      const { result } = await service.recalculate({
        organizationId: ORG_ID,
        exerciseId: EXERCISE_ID,
        actorId: ACTOR_ID,
        ctx: { ipAddress: null, userAgent: null },
      });

      // Tables manquantes ⇒ contribution neutre, score reste très haut.
      expect(result.score).toBe(100);
      expect(result.breakdown.anomalies.raw.anomaliesCount).toBe(0);
      expect(result.breakdown.bank_reconciliation.raw.totalLines).toBe(0);
    });

    it('rejette un exercice introuvable', async () => {
      const service = new AccountingScoreService(
        makeDataSource({}),
        makePeriodRepo(null),
        makeScoreRepo(),
        makeAudit(),
      );

      await expect(
        service.recalculate({
          organizationId: ORG_ID,
          exerciseId: EXERCISE_ID,
          actorId: ACTOR_ID,
          ctx: { ipAddress: null, userAgent: null },
        }),
      ).rejects.toMatchObject({ code: 'ACCOUNTING_PERIOD_NOT_FOUND' });
    });
  });

  describe('getLatest', () => {
    it('renvoie la dernière entité persistée pour (org, exercise)', async () => {
      const persisted = {
        id: 'score-1',
        organizationId: ORG_ID,
        exerciseId: EXERCISE_ID,
        score: 73,
        grade: 'B',
      } as unknown as AccountingScoreEntity;
      const scoreRepo = {
        findLatest: jest.fn(() => Promise.resolve(persisted)),
        insert: jest.fn(),
      } as unknown as AccountingScoreRepository;

      const service = new AccountingScoreService(
        makeDataSource({}),
        makePeriodRepo(makePeriod()),
        scoreRepo,
        makeAudit(),
      );
      const got = await service.getLatest(ORG_ID, EXERCISE_ID);
      expect(got).toBe(persisted);
      expect(scoreRepo.findLatest).toHaveBeenCalledWith(ORG_ID, EXERCISE_ID);
    });

    it("renvoie null si aucun score n'a jamais été calculé", async () => {
      const scoreRepo = {
        findLatest: jest.fn(() => Promise.resolve(null)),
        insert: jest.fn(),
      } as unknown as AccountingScoreRepository;
      const service = new AccountingScoreService(
        makeDataSource({}),
        makePeriodRepo(makePeriod()),
        scoreRepo,
        makeAudit(),
      );
      expect(await service.getLatest(ORG_ID, EXERCISE_ID)).toBeNull();
    });
  });
});
