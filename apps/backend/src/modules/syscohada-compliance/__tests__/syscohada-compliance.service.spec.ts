import type { DataSource } from 'typeorm';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { ReportsService } from '../../reports/services/reports.service';
import type {
  SyscohadaControlWithEvidence,
  SyscohadaDomain,
  SyscohadaKnowledgeService,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';
import { SyscohadaComplianceService } from '../services/syscohada-compliance.service';

/** Identifiants des contrôles câblés dans le service, par domaine. */
const CONTROL_BY_DOMAIN: Partial<Record<SyscohadaDomain, string>> = {
  reports: 'bilan-actif-egal-passif',
  journals: 'journal-equilibre-partie-double',
  'cash-flow': 'cashflow-variation-coherente',
};

function makeControl(domain: SyscohadaDomain, id: string): SyscohadaControlWithEvidence {
  return {
    id,
    domain,
    label: `Contrôle ${id}`,
    description: 'desc',
    severity: 'blocking',
    legalBasis: ['AUDCIF art. 8'],
    tome: 3,
    evidenceQuery: 'q',
    citation: {
      tome: 3,
      sourceTitle: 'Guide Tome 3',
      sourceFile: 'tome3.md',
      lineStart: 1,
      lineEnd: 2,
      excerpt: 'extrait verbatim',
      score: 1,
    },
  };
}

interface Mocks {
  readonly reports: jest.Mocked<Pick<ReportsService, 'getBalanceSheet'>>;
  readonly dataSource: { query: jest.Mock };
  readonly knowledge: { getModuleControls: jest.Mock };
  readonly service: SyscohadaComplianceService;
}

function setup(opts?: {
  balanceTotals?: { actif: string; passif: string; difference: string };
  unbalancedRows?: Array<{ id: string; entry_number: string; imbalance: string }>;
  balanceThrows?: boolean;
}): Mocks {
  const totals = opts?.balanceTotals ?? { actif: '1000.00', passif: '1000.00', difference: '0.00' };

  const reports = {
    getBalanceSheet: jest.fn(async () => {
      if (opts?.balanceThrows) throw new Error('bilan indisponible');
      return { totals } as Awaited<ReturnType<ReportsService['getBalanceSheet']>>;
    }),
  } as unknown as jest.Mocked<Pick<ReportsService, 'getBalanceSheet'>>;

  const dataSource = {
    query: jest.fn(async () => opts?.unbalancedRows ?? []),
  };

  const knowledge = {
    getModuleControls: jest.fn((domain: SyscohadaDomain) => {
      const id = CONTROL_BY_DOMAIN[domain];
      return id ? [makeControl(domain, id)] : [];
    }),
  };

  const service = new SyscohadaComplianceService(
    reports as unknown as ReportsService,
    dataSource as unknown as DataSource,
    knowledge as unknown as SyscohadaKnowledgeService,
  );

  return { reports, dataSource, knowledge, service };
}

const ORG = asTenantId('11111111-1111-1111-1111-111111111111');
const QUERY = { fiscalYearStartDate: '2025-01-01', asAtDate: '2025-12-31' } as const;

describe('SyscohadaComplianceService', () => {
  it('rend un verdict "partial" quand les contrôles exécutables passent (TFT non évaluable)', async () => {
    const { service } = setup();

    const report = await service.evaluate(ORG, QUERY);

    expect(report.verdict).toBe('partial');
    expect(report.counts).toEqual({ pass: 2, fail: 0, notEvaluable: 1 });
    expect(report.organizationId).toBe(ORG);
    expect(report.asAtDate).toBe('2025-12-31');
    expect(report.results).toHaveLength(3);
  });

  it('attache à chaque résultat son contrôle sourcé du catalogue', async () => {
    const { service } = setup();

    const report = await service.evaluate(ORG, QUERY);
    const bilan = report.results.find((r) => r.controlId === 'bilan-actif-egal-passif');

    expect(bilan?.status).toBe('pass');
    expect(bilan?.control?.id).toBe('bilan-actif-egal-passif');
    expect(bilan?.control?.citation?.excerpt).toBe('extrait verbatim');
  });

  it('détecte un bilan déséquilibré → fail → verdict non_compliant', async () => {
    const { service } = setup({
      balanceTotals: { actif: '1000.00', passif: '900.00', difference: '100.00' },
    });

    const report = await service.evaluate(ORG, QUERY);
    const bilan = report.results.find((r) => r.controlId === 'bilan-actif-egal-passif');

    expect(bilan?.status).toBe('fail');
    expect(bilan?.data).toMatchObject({ difference: 100 });
    expect(report.verdict).toBe('non_compliant');
    expect(report.counts.fail).toBe(1);
  });

  it('tolère un écart d’arrondi inférieur à l’epsilon (≤ 0,01)', async () => {
    const { service } = setup({
      balanceTotals: { actif: '1000.01', passif: '1000.00', difference: '0.01' },
    });

    const report = await service.evaluate(ORG, QUERY);
    const bilan = report.results.find((r) => r.controlId === 'bilan-actif-egal-passif');

    expect(bilan?.status).toBe('pass');
  });

  it('détecte des écritures déséquilibrées en partie double → fail', async () => {
    const { service, dataSource } = setup({
      unbalancedRows: [
        { id: 'e1', entry_number: 'JV-001', imbalance: '12.50' },
        { id: 'e2', entry_number: 'JV-002', imbalance: '-3.00' },
      ],
    });

    const report = await service.evaluate(ORG, QUERY);
    const journal = report.results.find((r) => r.controlId === 'journal-equilibre-partie-double');

    expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), [
      ORG,
      QUERY.fiscalYearStartDate,
      QUERY.asAtDate,
    ]);
    expect(journal?.status).toBe('fail');
    expect(journal?.data).toMatchObject({ unbalancedCount: 2 });
    expect((journal?.data as { samples: unknown[] }).samples).toEqual([
      { entryNumber: 'JV-001', imbalance: '12.50' },
      { entryNumber: 'JV-002', imbalance: '-3.00' },
    ]);
    expect(report.verdict).toBe('non_compliant');
  });

  it('capture les erreurs d’exécution d’un contrôle en "not_evaluable" sans lever', async () => {
    const { service } = setup({ balanceThrows: true });

    const report = await service.evaluate(ORG, QUERY);
    const bilan = report.results.find((r) => r.controlId === 'bilan-actif-egal-passif');

    expect(bilan?.status).toBe('not_evaluable');
    expect(bilan?.detail).toContain('bilan indisponible');
    // Le bilan échoue (n/a) mais le journal passe → pas de fail → verdict partial.
    expect(report.verdict).toBe('partial');
    expect(report.counts.notEvaluable).toBe(2);
  });

  it('déclare le contrôle TFT comme non évaluable avec sa justification doctrinale', async () => {
    const { service } = setup();

    const report = await service.evaluate(ORG, QUERY);
    const tft = report.results.find((r) => r.controlId === 'cashflow-variation-coherente');

    expect(tft?.status).toBe('not_evaluable');
    expect(tft?.domain).toBe('cash-flow');
    expect(tft?.detail).toContain('Tableau des flux de trésorerie');
    expect(tft?.control?.id).toBe('cashflow-variation-coherente');
  });
});
