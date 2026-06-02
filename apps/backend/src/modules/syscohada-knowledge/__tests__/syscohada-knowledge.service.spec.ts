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

  it('returns module guidance with searchable evidence from the Guide PDFs', () => {
    const service = makeService();

    const guidance = service.getModuleGuidance('reports');

    expect(guidance.domain).toBe('reports');
    expect(guidance.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tome: 3,
          topic: expect.stringMatching(/financiers/i),
        }),
      ]),
    );
    expect(guidance.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceTitle: expect.stringMatching(/financiers/i),
          excerpt: expect.stringContaining('Tableau des flux'),
        }),
      ]),
    );
  });

  it('resolves the sources bundled in the module when no path is provided', () => {
    // Garde le chemin de production : sans sourcesDir ni .local, le service doit
    // lire les textes embarqués dans src/.../sources (copiés dans dist au build).
    const service = new SyscohadaKnowledgeService();

    const results = service.search({
      query: 'bilan compte de resultat etats financiers',
      limit: 1,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].tome).toBeGreaterThanOrEqual(1);
    expect(results[0].excerpt.length).toBeGreaterThan(0);
  });

  it('grounds every extended business domain in the bundled Guide PDFs', () => {
    // Corpus réel embarqué (src/.../sources) : on vérifie que les domaines métier
    // ajoutés ramènent bien des extraits sourcés du Guide, sinon ils n'ont aucune
    // valeur doctrinale pour les DAF/comptables.
    const service = new SyscohadaKnowledgeService();

    const groundedDomains: ReadonlyArray<
      Parameters<SyscohadaKnowledgeService['getModuleGuidance']>[0]
    > = [
      'leases',
      'provisions',
      'impairments',
      'subsidies',
      'actuarial-commitments',
      'regularizations',
      'business-combinations',
      'bills-of-exchange',
      'multi-currency',
      'pledged-assets',
      'cash-flow',
    ];

    for (const domain of groundedDomains) {
      const guidance = service.getModuleGuidance(domain);
      expect(guidance.references.length).toBeGreaterThan(0);
      expect(guidance.controls.length).toBeGreaterThan(0);
      // Au moins un extrait verbatim du Guide remonte pour le domaine.
      expect(guidance.evidence.length).toBeGreaterThan(0);
      // Au moins un contrôle du domaine est corroboré par une citation sourcée.
      expect(guidance.controls.some((c) => c.citation !== null)).toBe(true);
    }
  });

  it('exposes named controls with legal basis and attached citation', () => {
    const service = makeService();

    const controls = service.getModuleControls('reports');

    expect(controls.length).toBeGreaterThan(0);
    const balance = controls.find((c) => c.id === 'bilan-actif-egal-passif');
    expect(balance).toBeDefined();
    expect(balance?.legalBasis.join(' ')).toMatch(/art\.\s*8/i);
    // citation est soit un extrait sourcé, soit null si le corpus de test ne couvre pas le sujet
    expect(balance).toHaveProperty('citation');
  });

  it('accepts large extracted SYSCOHADA PDFs saved as plain .pdf.txt sources', () => {
    const root = mkdtempSync(join(tmpdir(), 'syscohada-kb-act-'));
    writeFileSync(
      join(root, 'ACTE UNIFORME SYSCOHADA REVISE.pdf.txt'),
      [
        'ACTE UNIFORME RELATIF AU DROIT COMPTABLE ET A L INFORMATION FINANCIERE',
        'Article 17',
        "Toute entreprise tient un livre-journal et appuie chaque enregistrement",
        'comptable sur une pièce justificative datée et conservée.',
      ].join('\n'),
      'utf8',
    );

    const service = new SyscohadaKnowledgeService({ sourcesDir: root });
    const results = service.search({
      query: 'piece justificative livre journal enregistrement comptable',
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0].sourceFile).toBe('ACTE UNIFORME SYSCOHADA REVISE.pdf.txt');
    expect(results[0].sourceTitle).toBe('ACTE UNIFORME SYSCOHADA REVISE');
    expect(results[0].tome).toBe(0);
    expect(results[0].excerpt).toContain('pièce justificative');
  });
});
