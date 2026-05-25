import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import { RuleBasedAssistantProvider } from '../services/rule-based-assistant-provider';

/**
 * `RuleBasedAssistantProvider` — vérifie le routing intent + les
 * réponses générées sur des datasets SQL mockés.
 */
describe('RuleBasedAssistantProvider', () => {
  const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
  const PERIOD_ID = '00000000-0000-4000-8000-000000000010';

  let provider: RuleBasedAssistantProvider;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [RuleBasedAssistantProvider, { provide: DataSource, useValue: dataSource }],
    }).compile();
    provider = module.get(RuleBasedAssistantProvider);
  });

  describe('intent matchers', () => {
    it('detects an "account evolution" question', () => {
      expect(provider.matchAccountEvolution('pourquoi le compte 6132 augmente ?')).toEqual({
        accountCode: '6132',
      });
      expect(provider.matchAccountEvolution('pourquoi 624 diminue cette annee')).toEqual({
        accountCode: '624',
      });
    });

    it('detects an "account spend" question', () => {
      expect(provider.matchAccountSpend('combien j ai depense en 6132 ?')).toEqual({
        accountCode: '6132',
      });
      expect(provider.matchAccountSpend('total compte 60')).toEqual({ accountCode: '60' });
    });

    it('detects an "account balance" question', () => {
      expect(provider.matchAccountBalance('solde du compte 411')).toEqual({
        accountCode: '411',
      });
      expect(provider.matchAccountBalance('balance 521')).toEqual({ accountCode: '521' });
    });

    it('detects an "anomalies summary" question', () => {
      expect(provider.matchAnomaliesSummary('quelles anomalies detectees ?')).toBe(true);
      expect(provider.matchAnomaliesSummary('anomalies de la periode')).toBe(true);
      expect(provider.matchAnomaliesSummary('combien d ecritures normales')).toBe(false);
    });

    it('detects a "top risky" question', () => {
      expect(provider.matchTopRisky('quelle est l ecriture la plus risquee ?')).toBe(true);
      expect(provider.matchTopRisky('top operation plus risqu')).toBe(true);
    });
  });

  describe('answer composition', () => {
    it('answers account_evolution with a delta in XOF', async () => {
      dataSource.query.mockResolvedValue([
        { period: 'current', total_debit: '500000', total_credit: '100000', entry_count: '12' },
        { period: 'previous', total_debit: '200000', total_credit: '50000', entry_count: '8' },
      ]);
      const answer = await provider.ask('pourquoi le compte 6132 augmente ?', {
        organizationId: ORG_ID,
        periodId: PERIOD_ID,
      });
      expect(answer.matchedIntent).toBe('account_evolution');
      expect(answer.answer).toMatch(/augmenté/);
      expect(answer.answer).toMatch(/6132/);
      expect(answer.supportingData?.delta).toBe(250000);
    });

    it('answers account_spend with the total debit', async () => {
      dataSource.query.mockResolvedValue([{ total_debit: '1234567', entry_count: '7' }]);
      const answer = await provider.ask('combien j ai depense en 6132', {
        organizationId: ORG_ID,
      });
      expect(answer.matchedIntent).toBe('account_spend');
      expect(answer.supportingData?.totalDebit).toBe(1234567);
    });

    it('answers account_balance with debit / credit / net', async () => {
      dataSource.query.mockResolvedValue([{ debit: '500000', credit: '150000' }]);
      const answer = await provider.ask('solde du compte 411', { organizationId: ORG_ID });
      expect(answer.matchedIntent).toBe('account_balance');
      expect(answer.answer).toMatch(/débiteur/);
      expect(answer.supportingData?.net).toBe(350000);
    });

    it('answers anomalies_summary with the type breakdown', async () => {
      dataSource.query.mockResolvedValue([
        { anomaly_type: 'extreme_amount', n: '5', avg_score: '72' },
        { anomaly_type: 'potential_duplicate', n: '3', avg_score: '50' },
      ]);
      const answer = await provider.ask('quelles anomalies detectees ?', {
        organizationId: ORG_ID,
      });
      expect(answer.matchedIntent).toBe('anomalies_summary');
      expect(answer.supportingData?.total).toBe(8);
      expect(answer.answer).toMatch(/montant extrême/);
    });

    it('answers top_risky with the highest score', async () => {
      dataSource.query.mockResolvedValue([
        {
          anomaly_type: 'extreme_amount',
          risk_score: '95',
          reasons: ['Montant 8 σ au-dessus de la moyenne'],
          entry_id: 'e-1',
          account_id: 'a-1',
        },
      ]);
      const answer = await provider.ask('quelle est l ecriture la plus risquee', {
        organizationId: ORG_ID,
      });
      expect(answer.matchedIntent).toBe('top_risky');
      expect(answer.answer).toMatch(/95/);
      expect(answer.supportingData?.riskScore).toBe(95);
    });

    it('returns matchedIntent=null on unrecognised question', async () => {
      const answer = await provider.ask('quel temps fait-il aujourd hui ?', {
        organizationId: ORG_ID,
      });
      expect(answer.matchedIntent).toBeNull();
      expect(answer.confidence).toBe(0);
      expect(answer.answer).toMatch(/pas reconnu/i);
    });
  });

  describe('top_risky empty store', () => {
    it('gracefully tells the user no anomaly is in the table', async () => {
      dataSource.query.mockResolvedValue([]);
      const answer = await provider.ask('quelle est l ecriture la plus risquee', {
        organizationId: ORG_ID,
      });
      expect(answer.matchedIntent).toBe('top_risky');
      expect(answer.answer).toMatch(/Aucune anomalie en base/);
    });
  });
});
