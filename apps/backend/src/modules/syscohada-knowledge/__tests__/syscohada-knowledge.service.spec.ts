import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SyscohadaKnowledgeService } from '../services/syscohada-knowledge.service';

describe('SyscohadaKnowledgeService', () => {
  function makeService(): SyscohadaKnowledgeService {
    const root = mkdtempSync(join(tmpdir(), 'syscohada-kb-'));
    writeFileSync(
      join(
        root,
        "Guide d'application du SYSCOHADA REVISE 3_Présentation des états financiers annuels.pdf.1-end.txt",
      ),
      [
        'GUIDE',
        'SYSCOHADA',
        'Présentation des états financiers annuels',
        'Le Tableau des flux de trésorerie présente les flux opérationnels,',
        "les flux d'investissement et les flux de financement.",
        'Les postes FA à FQ et ZA à ZH structurent le tableau.',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(root, "Guide d'application du SYSCOHADA REVISE 1_Opéraions courante .pdf.1-end.txt"),
      [
        'GUIDE SYSCOHADA',
        'Opérations courantes',
        'Les immobilisations sont amorties selon leur durée probable',
        "d'utilisation et leur base amortissable.",
      ].join('\n'),
      'utf8',
    );

    return new SyscohadaKnowledgeService({ sourcesDir: root });
  }

  it('searches the extracted Guide PDFs and returns source metadata', () => {
    const service = makeService();

    const results = service.search({
      query: 'tableau des flux de tresorerie postes FA ZA',
      domain: 'reports',
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0].tome).toBe(3);
    expect(results[0].sourceTitle).toContain('Présentation des états financiers');
    expect(results[0].excerpt).toContain('Tableau des flux de trésorerie');
    expect(results[0].lineStart).toBeGreaterThanOrEqual(1);
  });

  it('exposes doctrine domains for every major accounting module', () => {
    const service = makeService();

    expect(service.getSupportedDomains()).toEqual(
      expect.arrayContaining([
        'accounting-plan',
        'journals',
        'assets',
        'inventory',
        'tva',
        'reports',
        'ai',
      ]),
    );
    expect(service.getDomainReferences('assets')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tome: 1,
          topic: expect.stringMatching(/immobilisations/i),
        }),
      ]),
    );
  });
});
