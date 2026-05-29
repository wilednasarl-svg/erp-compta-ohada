import type { DataSource } from 'typeorm';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { SyscohadaKnowledgeService } from '../../syscohada-knowledge/services/syscohada-knowledge.service';
import { RuleBasedAssistantProvider } from '../services/rule-based-assistant-provider';

describe('RuleBasedAssistantProvider with SYSCOHADA knowledge', () => {
  const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');

  it('answers doctrine questions from the SYSCOHADA guide before SQL heuristics', async () => {
    const dataSource = { query: jest.fn() } as unknown as DataSource;
    const knowledge = {
      answerQuestion: jest.fn().mockResolvedValue({
        answer:
          'Selon le Guide SYSCOHADA Tome 3, le Tableau des flux de trésorerie présente les flux opérationnels, investissement et financement.',
        citations: [
          {
            tome: 3,
            sourceTitle: 'Guide SYSCOHADA Tome 3',
            sourceFile: 'guide-tome-3.pdf.1-end.txt',
            lineStart: 10,
            lineEnd: 20,
          },
        ],
      }),
    } as unknown as SyscohadaKnowledgeService;
    const provider = new RuleBasedAssistantProvider(dataSource, knowledge);

    const answer = await provider.ask('Que dit le SYSCOHADA sur le TFT ?', {
      organizationId: ORG_ID,
    });

    expect(dataSource.query).not.toHaveBeenCalled();
    expect(knowledge.answerQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.stringContaining('SYSCOHADA'), domain: 'reports' }),
    );
    expect(answer.matchedIntent).toBe('syscohada_knowledge');
    expect(answer.answer).toContain('Guide SYSCOHADA Tome 3');
    expect(answer.supportingData?.citations).toEqual(
      expect.arrayContaining([expect.objectContaining({ tome: 3 })]),
    );
  });

  it('routes extended business topics to their SYSCOHADA domain', async () => {
    const dataSource = { query: jest.fn() } as unknown as DataSource;
    const knowledge = {
      answerQuestion: jest.fn().mockResolvedValue({
        answer: 'Extrait du Guide.',
        citations: [{ tome: 2, sourceTitle: 't', sourceFile: 'f', lineStart: 1, lineEnd: 2 }],
      }),
    } as unknown as SyscohadaKnowledgeService;
    const provider = new RuleBasedAssistantProvider(dataSource, knowledge);

    const cases: ReadonlyArray<{ question: string; domain: string }> = [
      { question: 'Comment comptabiliser une location-acquisition ?', domain: 'leases' },
      {
        question: 'Quand constituer une provision pour risques et charges ?',
        domain: 'provisions',
      },
      { question: 'Comment traiter une subvention d’investissement ?', domain: 'subsidies' },
      { question: 'Comment évaluer un engagement de retraite ?', domain: 'actuarial-commitments' },
      { question: 'Comment escompter un effet de commerce ?', domain: 'bills-of-exchange' },
      {
        question: 'Comment comptabiliser un écart de conversion sur devise ?',
        domain: 'multi-currency',
      },
      { question: 'Comment évaluer les apports d’une fusion ?', domain: 'business-combinations' },
      { question: 'Où présenter une garantie hypothèque donnée ?', domain: 'pledged-assets' },
      { question: 'Comment constater une charge constatée d’avance ?', domain: 'regularizations' },
    ];

    for (const { question, domain } of cases) {
      (knowledge.answerQuestion as jest.Mock).mockClear();
      const answer = await provider.ask(question, { organizationId: ORG_ID });
      expect(knowledge.answerQuestion).toHaveBeenCalledWith(expect.objectContaining({ domain }));
      expect(answer.matchedIntent).toBe('syscohada_knowledge');
      expect(dataSource.query).not.toHaveBeenCalled();
    }
  });
});
