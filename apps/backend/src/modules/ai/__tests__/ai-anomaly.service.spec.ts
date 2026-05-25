import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AuditTrailService } from '../../audit/services/audit-trail.service';
import { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import { AiAnomalyRepository } from '../repositories/ai-anomaly.repository';
import { AiAnomalyService } from '../services/ai-anomaly.service';
import { LLM_PROVIDER, type LlmProvider } from '../services/llm-provider';

describe('AiAnomalyService', () => {
  const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
  const ACTOR_ID = '00000000-0000-4000-8000-000000000002';
  const PERIOD_ID = '00000000-0000-4000-8000-000000000010';
  const ctx = { ipAddress: null, userAgent: null };

  let service: AiAnomalyService;
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let anomalyRepo: { deleteByPeriod: jest.Mock; upsert: jest.Mock; listForOrg: jest.Mock };
  let periodRepo: { findById: jest.Mock };
  let audit: { record: jest.Mock };
  let llmProvider: jest.Mocked<LlmProvider>;

  beforeEach(async () => {
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn().mockImplementation(async (cb: (m: unknown) => Promise<unknown>) => {
        return cb({} as unknown);
      }),
    };
    anomalyRepo = {
      deleteByPeriod: jest.fn().mockResolvedValue(0),
      upsert: jest.fn().mockResolvedValue(undefined),
      listForOrg: jest.fn().mockResolvedValue({ anomalies: [], total: 0 }),
    };
    periodRepo = {
      findById: jest.fn().mockResolvedValue({
        id: PERIOD_ID,
        organizationId: ORG_ID,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      }),
    };
    audit = { record: jest.fn().mockResolvedValue(null) };
    // Default: provider returns null (no semantic findings) → wave 1 path.
    llmProvider = {
      id: 'mock_llm_v1',
      suggestAccount: jest.fn().mockResolvedValue(null),
      detectSemanticAnomaly: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAnomalyService,
        { provide: DataSource, useValue: dataSource },
        { provide: AiAnomalyRepository, useValue: anomalyRepo },
        { provide: AccountingPeriodRepository, useValue: periodRepo },
        { provide: AuditTrailService, useValue: audit },
        { provide: LLM_PROVIDER, useValue: llmProvider },
      ],
    }).compile();

    service = module.get(AiAnomalyService);
  });

  it('throws when the period does not belong to the tenant', async () => {
    periodRepo.findById.mockResolvedValueOnce(null);
    await expect(
      service.scanExerciseForAnomalies({
        organizationId: ORG_ID,
        periodId: PERIOD_ID,
        actorId: ACTOR_ID,
        ctx,
      }),
    ).rejects.toThrow(/Accounting period.*not found/);
  });

  it('returns zeroed stats when the period has no validated entries', async () => {
    dataSource.query.mockResolvedValueOnce([]);
    const stats = await service.scanExerciseForAnomalies({
      organizationId: ORG_ID,
      periodId: PERIOD_ID,
      actorId: ACTOR_ID,
      ctx,
    });
    expect(stats.entriesScanned).toBe(0);
    expect(stats.linesScanned).toBe(0);
    expect(stats.anomaliesDetected).toBe(0);
    expect(anomalyRepo.upsert).not.toHaveBeenCalled();
    expect(anomalyRepo.deleteByPeriod).toHaveBeenCalledWith(ORG_ID, PERIOD_ID, expect.anything());
  });

  it('persists merged findings for a synthetic dataset and emits audit', async () => {
    dataSource.query.mockResolvedValueOnce([
      {
        entry_id: 'e1',
        entry_date: '2026-06-15',
        journal_code: 'CA',
        account_id: 'a-571',
        account_code: '571',
        debit: '100000.00',
        credit: '0',
        description: 'Apport caisse',
        partner: null,
      },
      {
        entry_id: 'e2',
        entry_date: '2026-06-15',
        journal_code: 'AC',
        account_id: 'a-624',
        account_code: '624',
        debit: '75000.00',
        credit: '0',
        description: 'Achat fournitures',
        partner: 'SODECI',
      },
      {
        entry_id: 'e3',
        entry_date: '2026-06-16',
        journal_code: 'AC',
        account_id: 'a-624',
        account_code: '624',
        debit: '75000.00',
        credit: '0',
        description: 'Achat fournitures',
        partner: 'SODECI',
      },
    ]);
    const stats = await service.scanExerciseForAnomalies({
      organizationId: ORG_ID,
      periodId: PERIOD_ID,
      actorId: ACTOR_ID,
      ctx,
    });
    expect(stats.entriesScanned).toBe(3);
    expect(stats.linesScanned).toBe(3);
    expect(stats.anomaliesDetected).toBeGreaterThan(0);
    expect(anomalyRepo.upsert.mock.calls.length).toBeGreaterThanOrEqual(3);
    const types = anomalyRepo.upsert.mock.calls.map(
      (c: [{ anomalyType: string }, unknown]) => c[0].anomalyType,
    );
    expect(new Set(types)).toEqual(
      expect.objectContaining(new Set(['sensitive_account', 'potential_duplicate'])),
    );
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const call = audit.record.mock.calls[0][0] as { module: string; action: string };
    expect(call.module).toBe('ai');
    expect(call.action).toBe('anomalies_scanned');
  });

  it('full recalc semantics: delete before reinsert', async () => {
    dataSource.query.mockResolvedValueOnce([
      {
        entry_id: 'e1',
        entry_date: '2026-06-15',
        journal_code: 'CA',
        account_id: 'a-571',
        account_code: '571',
        debit: '50000.00',
        credit: '0',
        description: null,
        partner: null,
      },
    ]);
    await service.scanExerciseForAnomalies({
      organizationId: ORG_ID,
      periodId: PERIOD_ID,
      actorId: ACTOR_ID,
      ctx,
    });
    const deleteOrder = anomalyRepo.deleteByPeriod.mock.invocationCallOrder[0];
    const firstUpsertOrder = anomalyRepo.upsert.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(firstUpsertOrder);
  });

  describe('LLM semantic anomaly detection (wave 2)', () => {
    it('persists a semantic_anomaly finding when LLM flags a mismatch with confidence > 0.6', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          entry_id: 'e1',
          entry_date: '2026-06-10',
          journal_code: 'AC',
          account_id: 'a-601',
          account_code: '601',
          debit: '500000.00',
          credit: '0',
          description: 'Paiement salaires juin',
          partner: null,
        },
      ]);
      llmProvider.detectSemanticAnomaly.mockResolvedValue({
        isAnomaly: true,
        confidence: 0.92,
        reasoning: 'Libellé "Salaire" sur compte 601 (Achats) — devrait être 661.',
      });
      const stats = await service.scanExerciseForAnomalies({
        organizationId: ORG_ID,
        periodId: PERIOD_ID,
        actorId: ACTOR_ID,
        ctx,
      });
      expect(stats.anomaliesDetected).toBeGreaterThan(0);
      const upserts = anomalyRepo.upsert.mock.calls.map(
        (c: [{ anomalyType: string; detectedBy?: string; reasons: string[] }, unknown]) => c[0],
      );
      const semantic = upserts.find((u) => u.anomalyType === 'semantic_anomaly');
      expect(semantic).toBeDefined();
      expect(semantic!.detectedBy).toBe('llm_v1');
      expect(semantic!.reasons[0]).toContain('Salaire');
    });

    it('ignores LLM findings below the confidence floor', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          entry_id: 'e1',
          entry_date: '2026-06-10',
          journal_code: 'AC',
          account_id: 'a-601',
          account_code: '601',
          debit: '500000.00',
          credit: '0',
          description: 'Paiement fournisseur',
          partner: null,
        },
      ]);
      llmProvider.detectSemanticAnomaly.mockResolvedValue({
        isAnomaly: true,
        confidence: 0.4,
        reasoning: 'Pas sûr.',
      });
      await service.scanExerciseForAnomalies({
        organizationId: ORG_ID,
        periodId: PERIOD_ID,
        actorId: ACTOR_ID,
        ctx,
      });
      const upserts = anomalyRepo.upsert.mock.calls.map(
        (c: [{ anomalyType: string }, unknown]) => c[0],
      );
      expect(upserts.find((u) => u.anomalyType === 'semantic_anomaly')).toBeUndefined();
    });

    it('skips lines with empty description without calling the LLM', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          entry_id: 'e1',
          entry_date: '2026-06-10',
          journal_code: 'AC',
          account_id: 'a-601',
          account_code: '601',
          debit: '500000.00',
          credit: '0',
          description: null,
          partner: null,
        },
      ]);
      await service.scanExerciseForAnomalies({
        organizationId: ORG_ID,
        periodId: PERIOD_ID,
        actorId: ACTOR_ID,
        ctx,
      });
      expect(llmProvider.detectSemanticAnomaly).not.toHaveBeenCalled();
    });

    it('continues scanning when the LLM provider throws (resilience)', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          entry_id: 'e1',
          entry_date: '2026-06-10',
          journal_code: 'AC',
          account_id: 'a-601',
          account_code: '601',
          debit: '500000.00',
          credit: '0',
          description: 'Paiement fournisseur',
          partner: null,
        },
      ]);
      llmProvider.detectSemanticAnomaly.mockRejectedValue(new Error('network'));
      await expect(
        service.scanExerciseForAnomalies({
          organizationId: ORG_ID,
          periodId: PERIOD_ID,
          actorId: ACTOR_ID,
          ctx,
        }),
      ).resolves.toBeDefined();
    });
  });
});
