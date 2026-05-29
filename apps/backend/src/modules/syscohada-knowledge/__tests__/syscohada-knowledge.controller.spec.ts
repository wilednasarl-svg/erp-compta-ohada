import { SyscohadaKnowledgeController } from '../controllers/syscohada-knowledge.controller';
import type { SyscohadaKnowledgeService } from '../services/syscohada-knowledge.service';

describe('SyscohadaKnowledgeController', () => {
  it('lists doctrine guidance for all business domains', () => {
    const service = {
      getSupportedDomains: jest.fn().mockReturnValue(['reports', 'assets']),
      getModuleGuidance: jest.fn((domain: string) => ({
        domain,
        references: [{ domain, tome: 3, topic: 'Etats financiers', keywords: ['bilan'] }],
        evidence: [],
      })),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new SyscohadaKnowledgeController(service);

    const result = controller.listDomains();

    expect(result.domains).toHaveLength(2);
    expect(result.domains[0]).toEqual(expect.objectContaining({ domain: 'reports' }));
    expect(service.getModuleGuidance).toHaveBeenCalledWith('reports');
  });

  it('returns named controls with legal basis for a domain', () => {
    const service = {
      getSupportedDomains: jest.fn().mockReturnValue(['journals', 'reports']),
      getModuleControls: jest.fn().mockReturnValue([
        {
          id: 'journal-equilibre-partie-double',
          domain: 'journals',
          label: 'Équilibre de l’écriture',
          description: 'Débit = Crédit',
          severity: 'blocking',
          legalBasis: ['AUDCIF art. 17'],
          tome: 1,
          evidenceQuery: 'partie double',
          citation: null,
        },
      ]),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new SyscohadaKnowledgeController(service);

    const result = controller.getDomainControls('journals');

    expect(service.getModuleControls).toHaveBeenCalledWith('journals');
    expect(result.domain).toBe('journals');
    expect(result.controls[0]).toEqual(
      expect.objectContaining({ id: 'journal-equilibre-partie-double', severity: 'blocking' }),
    );
  });

  it('searches doctrine excerpts with citations', () => {
    const service = {
      getSupportedDomains: jest.fn().mockReturnValue(['reports', 'assets']),
      search: jest.fn().mockReturnValue([
        {
          tome: 3,
          sourceTitle: 'Guide SYSCOHADA Tome 3',
          sourceFile: 'guide-tome-3.pdf.1-end.txt',
          lineStart: 30,
          lineEnd: 42,
          excerpt: 'Bilan et compte de resultat',
          score: 9,
        },
      ]),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new SyscohadaKnowledgeController(service);

    const result = controller.search({ query: 'bilan', domain: 'reports', limit: 5 });

    expect(service.search).toHaveBeenCalledWith({ query: 'bilan', domain: 'reports', limit: 5 });
    expect(result.results[0]).toEqual(expect.objectContaining({ tome: 3, lineStart: 30 }));
  });
});
