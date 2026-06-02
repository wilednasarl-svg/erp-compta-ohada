import type { DataSource } from 'typeorm';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CashFlowService } from '../../reports/services/cash-flow.service';
import type { ReportsService } from '../../reports/services/reports.service';
import type {
  SyscohadaControlWithEvidence,
  SyscohadaDomain,
  SyscohadaKnowledgeService,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';
import { SyscohadaComplianceService } from '../services/syscohada-compliance.service';

const CONTROL_BY_DOMAIN: Partial<Record<SyscohadaDomain, string>> = {
  reports: 'bilan-actif-egal-passif',
  journals: 'journal-equilibre-partie-double',
  'cash-flow': 'cashflow-variation-coherente',
};

function makeControl(domain: SyscohadaDomain, id: string): SyscohadaControlWithEvidence {
  return {
    id,
    domain,
    label: `Controle ${id}`,
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
  readonly cashFlow: jest.Mocked<Pick<CashFlowService, 'getCashFlow'>>;
  readonly dataSource: { query: jest.Mock };
  readonly knowledge: { getModuleControls: jest.Mock };
  readonly service: SyscohadaComplianceService;
}

function setup(opts?: {
  balanceTotals?: { actif: string; passif: string; difference: string };
  unbalancedRows?: Array<{ id: string; entry_number: string; imbalance: string }>;
  balanceThrows?: boolean;
  cashFlow?: { coherenceCheck: string };
  cashFlowThrows?: boolean;
}): Mocks {
  const totals = opts?.balanceTotals ?? { actif: '1000.00', passif: '1000.00', difference: '0.00' };

  const reports = {
    getBalanceSheet: jest.fn(async () => {
      if (opts?.balanceThrows) throw new Error('bilan indisponible');
      return { totals } as Awaited<ReturnType<ReportsService['getBalanceSheet']>>;
    }),
  } as unknown as jest.Mocked<Pick<ReportsService, 'getBalanceSheet'>>;

  const cashFlow = {
    getCashFlow: jest.fn(async () => {
      if (opts?.cashFlowThrows) throw new Error('tft indisponible');
      return {
        coherenceCheck: opts?.cashFlow?.coherenceCheck ?? '0.00',
        closingCash: '1000.00',
        netCashVariation: '100.00',
      } as Awaited<ReturnType<CashFlowService['getCashFlow']>>;
    }),
  } as unknown as jest.Mocked<Pick<CashFlowService, 'getCashFlow'>>;

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
    cashFlow as unknown as CashFlowService,
    dataSource as unknown as DataSource,
    knowledge as unknown as SyscohadaKnowledgeService,
  );

  return { reports, cashFlow, dataSource, knowledge, service };
}

const ORG = asTenantId('11111111-1111-1111-1111-111111111111');
const QUERY = { fiscalYearStartDate: '2025-01-01', asAtDate: '2025-12-31' } as const;

describe('SyscohadaComplianceService', () => {
  it('returns compliant when balance, journal and TFT checks pass', async () => {
    const { service } = setup();

    const report = await service.evaluate(ORG, QUERY);

    expect(report.verdict).toBe('compliant');
    expect(report.counts).toEqual({ pass: 3, fail: 0, notEvaluable: 0 });
    expect(report.organizationId).toBe(ORG);
    expect(report.asAtDate).toBe('2025-12-31');
    expect(report.results).toHaveLength(3);
  });

  it('attaches the sourced catalog control to each result', async () => {
    const { service } = setup();

    const report = await service.evaluate(ORG, QUERY);
    const bilan = report.results.find((r) => r.controlId === 'bilan-actif-egal-passif');

    expect(bilan?.status).toBe('pass');
    expect(bilan?.control?.id).toBe('bilan-actif-egal-passif');
    expect(bilan?.control?.citation?.excerpt).toBe('extrait verbatim');
  });

  it('detects an unbalanced balance sheet', async () => {
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

  it('tolerates a rounding difference inside epsilon', async () => {
    const { service } = setup({
      balanceTotals: { actif: '1000.01', passif: '1000.00', difference: '0.01' },
    });

    const report = await service.evaluate(ORG, QUERY);
    const bilan = report.results.find((r) => r.controlId === 'bilan-actif-egal-passif');

    expect(bilan?.status).toBe('pass');
  });

  it('detects unbalanced validated journal entries', async () => {
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

  it('captures check execution errors as not_evaluable without throwing', async () => {
    const { service } = setup({ balanceThrows: true });

    const report = await service.evaluate(ORG, QUERY);
    const bilan = report.results.find((r) => r.controlId === 'bilan-actif-egal-passif');

    expect(bilan?.status).toBe('not_evaluable');
    expect(bilan?.detail).toContain('bilan indisponible');
    expect(report.verdict).toBe('partial');
    expect(report.counts.notEvaluable).toBe(1);
  });

  it('executes the TFT reconciliation check through CashFlowService', async () => {
    const { service, cashFlow } = setup();

    const report = await service.evaluate(ORG, QUERY);
    const tft = report.results.find((r) => r.controlId === 'cashflow-variation-coherente');

    expect(cashFlow.getCashFlow).toHaveBeenCalledWith(ORG, {
      fromDate: QUERY.fiscalYearStartDate,
      toDate: QUERY.asAtDate,
    });
    expect(tft?.status).toBe('pass');
    expect(tft?.domain).toBe('cash-flow');
    expect(tft?.detail).toContain('TFT coherent');
    expect(tft?.control?.id).toBe('cashflow-variation-coherente');
  });

  it('fails when the TFT closing cash does not reconcile with treasury accounts', async () => {
    const { service } = setup({ cashFlow: { coherenceCheck: '42.00' } });

    const report = await service.evaluate(ORG, QUERY);
    const tft = report.results.find((r) => r.controlId === 'cashflow-variation-coherente');

    expect(tft?.status).toBe('fail');
    expect(tft?.data).toMatchObject({ coherenceCheck: 42 });
    expect(report.verdict).toBe('non_compliant');
  });
});
