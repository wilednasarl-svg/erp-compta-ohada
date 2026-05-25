import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AuditTrailService } from '../../audit/services/audit-trail.service';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import { AiSuggestionService } from '../services/ai-suggestion.service';
import { LLM_PROVIDER, type LlmProvider } from '../services/llm-provider';

describe('AiSuggestionService', () => {
  const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
  const ACTOR_ID = '00000000-0000-4000-8000-000000000002';
  const ctx = { ipAddress: null, userAgent: null };

  let service: AiSuggestionService;
  let dataSource: { query: jest.Mock };
  let audit: { record: jest.Mock };
  let llmProvider: jest.Mocked<LlmProvider>;

  beforeEach(async () => {
    dataSource = { query: jest.fn() };
    audit = { record: jest.fn().mockResolvedValue(null) };
    // Default: provider has no opinion → fallback path (preserves wave 1 tests).
    llmProvider = {
      id: 'mock_llm_v1',
      suggestAccount: jest.fn().mockResolvedValue(null),
      detectSemanticAnomaly: jest.fn().mockResolvedValue(null),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiSuggestionService,
        { provide: DataSource, useValue: dataSource },
        { provide: AuditTrailService, useValue: audit },
        { provide: LLM_PROVIDER, useValue: llmProvider },
      ],
    }).compile();
    service = module.get(AiSuggestionService);
  });

  describe('keyword pattern matching', () => {
    it('matches a loyer description to account 6132', async () => {
      dataSource.query.mockResolvedValue([]);
      const suggestion = await service.suggestAccountForEntry(
        { organizationId: ORG_ID, description: 'Loyer bureau juin 2026', side: 'debit' },
        ACTOR_ID,
        ctx,
      );
      expect(suggestion!.suggestedAccountCode).toBe('6132');
    });

    it('matches a salaire description to account 661', async () => {
      dataSource.query.mockResolvedValue([]);
      const suggestion = await service.suggestAccountForEntry(
        { organizationId: ORG_ID, description: 'Paiement salaire mensuel' },
        ACTOR_ID,
        ctx,
      );
      expect(suggestion!.suggestedAccountCode).toBe('661');
    });

    it('respects the side filter (vente only triggers on credit side)', async () => {
      dataSource.query.mockResolvedValue([]);
      const debitSide = await service.suggestAccountForEntry(
        { organizationId: ORG_ID, description: 'Vente marchandises', side: 'debit' },
        ACTOR_ID,
        ctx,
      );
      expect(debitSide).toBeNull();
      const creditSide = await service.suggestAccountForEntry(
        { organizationId: ORG_ID, description: 'Vente marchandises', side: 'credit' },
        ACTOR_ID,
        ctx,
      );
      expect(creditSide!.suggestedAccountCode).toBe('701');
    });

    it('is accent-insensitive (électricité → 6051)', async () => {
      dataSource.query.mockResolvedValue([]);
      const suggestion = await service.suggestAccountForEntry(
        { organizationId: ORG_ID, description: 'Facture électricité CIE mai' },
        ACTOR_ID,
        ctx,
      );
      expect(suggestion!.suggestedAccountCode).toBe('6051');
    });
  });

  describe('history matching', () => {
    it('returns the majority account from the 12-month history', async () => {
      dataSource.query.mockResolvedValue([
        { account_code: '6132', n: '40' },
        { account_code: '6181', n: '8' },
        { account_code: '6228', n: '2' },
      ]);
      const suggestion = await service.suggestAccountForEntry(
        { organizationId: ORG_ID, description: 'redevance plateforme cabinet' },
        ACTOR_ID,
        ctx,
      );
      expect(suggestion!.suggestedAccountCode).toBe('6132');
      expect(suggestion!.confidence).toBeGreaterThanOrEqual(75);
    });

    it('rejects history below the 25% confidence floor', async () => {
      dataSource.query.mockResolvedValue([
        { account_code: '6132', n: '5' },
        { account_code: '6181', n: '5' },
        { account_code: '6228', n: '5' },
        { account_code: '6324', n: '5' },
        { account_code: '6051', n: '5' },
      ]);
      const suggestion = await service.suggestAccountForEntry(
        { organizationId: ORG_ID, description: 'redevance plateforme cabinet' },
        ACTOR_ID,
        ctx,
      );
      expect(suggestion).toBeNull();
    });
  });

  describe('combination', () => {
    it('boosts confidence when pattern and history agree', async () => {
      dataSource.query.mockResolvedValue([
        { account_code: '6132', n: '6' },
        { account_code: '6181', n: '4' },
      ]);
      const suggestion = await service.suggestAccountForEntry(
        { organizationId: ORG_ID, description: 'Loyer immeuble Plateau' },
        ACTOR_ID,
        ctx,
      );
      expect(suggestion!.suggestedAccountCode).toBe('6132');
      expect(suggestion!.confidence).toBeGreaterThan(50);
      expect(suggestion!.confidence).toBeLessThanOrEqual(95);
      expect(suggestion!.reasons).toHaveLength(2);
    });

    it('returns an alternative when pattern and history disagree', async () => {
      dataSource.query.mockResolvedValue([
        { account_code: '6132', n: '6' },
        { account_code: '6181', n: '4' },
      ]);
      const suggestion = await service.suggestAccountForEntry(
        { organizationId: ORG_ID, description: 'salaire bureau' },
        ACTOR_ID,
        ctx,
      );
      expect(suggestion!.alternative).toBeDefined();
      expect(suggestion!.alternative!.accountCode).not.toBe(suggestion!.suggestedAccountCode);
    });
  });

  describe('audit', () => {
    it('emits a suggestion_requested audit event on every call', async () => {
      dataSource.query.mockResolvedValue([]);
      await service.suggestAccountForEntry(
        { organizationId: ORG_ID, description: 'Loyer Plateau' },
        ACTOR_ID,
        ctx,
      );
      expect(audit.record).toHaveBeenCalledTimes(1);
      const call = audit.record.mock.calls[0][0] as { module: string; action: string };
      expect(call.module).toBe('ai');
      expect(call.action).toBe('suggestion_requested');
    });
  });

  describe('LLM provider integration (wave 2)', () => {
    it('uses LLM suggestion when confidence > 0.6', async () => {
      dataSource.query.mockResolvedValue([]);
      llmProvider.suggestAccount.mockResolvedValue({
        accountCode: '627',
        confidence: 0.85,
        reasoning: 'Frais bancaires identifiés par contexte.',
      });
      const suggestion = await service.suggestAccountForEntry(
        { organizationId: ORG_ID, description: 'Commission CIB sur virement' },
        ACTOR_ID,
        ctx,
      );
      expect(suggestion).not.toBeNull();
      expect(suggestion!.suggestedAccountCode).toBe('627');
      expect(suggestion!.confidence).toBe(85);
      expect(suggestion!.reasons[0]).toContain('Frais bancaires');
      expect(llmProvider.suggestAccount).toHaveBeenCalledTimes(1);
      const auditCall = audit.record.mock.calls[0][0] as { after: { source: string } };
      expect(auditCall.after.source).toBe('mock_llm_v1');
    });

    it('falls back to heuristic when LLM confidence is below floor', async () => {
      dataSource.query.mockResolvedValue([]);
      llmProvider.suggestAccount.mockResolvedValue({
        accountCode: '627',
        confidence: 0.4,
        reasoning: 'Suggestion incertaine.',
      });
      const suggestion = await service.suggestAccountForEntry(
        { organizationId: ORG_ID, description: 'Loyer immeuble Plateau', side: 'debit' },
        ACTOR_ID,
        ctx,
      );
      // Heuristic catches loyer → 6132.
      expect(suggestion!.suggestedAccountCode).toBe('6132');
    });

    it('falls back to heuristic when LLM returns null (timeout, no key, etc.)', async () => {
      dataSource.query.mockResolvedValue([]);
      llmProvider.suggestAccount.mockResolvedValue(null);
      const suggestion = await service.suggestAccountForEntry(
        { organizationId: ORG_ID, description: 'Salaire mensuel personnel' },
        ACTOR_ID,
        ctx,
      );
      expect(suggestion!.suggestedAccountCode).toBe('661');
    });

    it('swallows LLM provider exceptions silently and falls back', async () => {
      dataSource.query.mockResolvedValue([]);
      llmProvider.suggestAccount.mockRejectedValue(new Error('network down'));
      const suggestion = await service.suggestAccountForEntry(
        { organizationId: ORG_ID, description: 'Loyer bureau' },
        ACTOR_ID,
        ctx,
      );
      expect(suggestion!.suggestedAccountCode).toBe('6132');
    });
  });
});
