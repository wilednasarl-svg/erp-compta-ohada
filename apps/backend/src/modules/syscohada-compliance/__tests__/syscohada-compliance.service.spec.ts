import type { DataSource } from 'typeorm';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CashFlowService } from '../../reports/services/cash-flow.service';
import type { ReportsService } from '../../reports/services/reports.service';
import { SYSCOHADA_CONTROL_CATALOG } from '../../syscohada-knowledge/data/control-catalog';
import type {
  SyscohadaControlWithEvidence,
  SyscohadaDomain,
  SyscohadaKnowledgeService,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';
import { SyscohadaComplianceService } from '../services/syscohada-compliance.service';

const CONTROLS_BY_DOMAIN: Partial<Record<SyscohadaDomain, string[]>> = {
  reports: ['bilan-actif-egal-passif'],
  journals: [
    'journal-equilibre-partie-double',
    'journal-chronologie-continuite',
    'journal-lettrage-tiers',
  ],
  'accounting-plan': ['plan-sens-normal-comptes', 'plan-numerotation-classes'],
  tva: ['tva-coherence-comptes'],
  regularizations: ['comptes-attente-soldes'],
  'cash-flow': ['cashflow-variation-coherente'],
};

function makeControl(domain: SyscohadaDomain, id: string): SyscohadaControlWithEvidence {
  return {
    id,
    domain,
    label: `Controle ${id}`,
    description: 'desc',
    // Sévérité réelle du catalogue → le verdict dépend de la sévérité.
    severity: SYSCOHADA_CONTROL_CATALOG.find((c) => c.id === id)?.severity ?? 'blocking',
    legalBasis: ['AUDCIF art. 8'],
    tome: 3,
    evidenceQuery: 'q',
    remediation: `Corriger ${id}`,
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

interface TrialRow {
  accountCode: string;
  accountLabel: string;
  endingDebit: string;
  endingCredit: string;
}

interface Mocks {
  readonly reports: jest.Mocked<Pick<ReportsService, 'getBalanceSheet' | 'getTrialBalance'>>;
  readonly cashFlow: jest.Mocked<Pick<CashFlowService, 'getCashFlow'>>;
  readonly dataSource: { query: jest.Mock };
  readonly knowledge: { getModuleControls: jest.Mock };
  readonly service: SyscohadaComplianceService;
}

function setup(opts?: {
  balanceTotals?: { actif: string; passif: string; difference: string };
  unbalancedRows?: Array<{ id: string; entry_number: string; imbalance: string }>;
  outOfPeriodRows?: Array<{
    entry_number: string;
    entry_date: string;
    start_date: string;
    end_date: string;
  }>;
  letteringRows?: Array<{ code: string; cnt: string }>;
  trialBalanceRows?: TrialRow[];
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
    getTrialBalance: jest.fn(async () => {
      return { rows: opts?.trialBalanceRows ?? [] } as unknown as Awaited<
        ReturnType<ReportsService['getTrialBalance']>
      >;
    }),
  } as unknown as jest.Mocked<Pick<ReportsService, 'getBalanceSheet' | 'getTrialBalance'>>;

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
    query: jest.fn(async (sql: string) => {
      if (/accounting_periods/i.test(sql)) return opts?.outOfPeriodRows ?? [];
      if (/organization_chart_accounts/i.test(sql)) return opts?.letteringRows ?? [];
      return opts?.unbalancedRows ?? [];
    }),
  };

  const knowledge = {
    getModuleControls: jest.fn((domain: SyscohadaDomain) =>
      (CONTROLS_BY_DOMAIN[domain] ?? []).map((id) => makeControl(domain, id)),
    ),
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
  it('returns compliant when balance, journal, account-sense and TFT checks pass', async () => {
    const { service } = setup();

    const report = await service.evaluate(ORG, QUERY);

    expect(report.verdict).toBe('compliant');
    expect(report.counts).toEqual({ pass: 9, fail: 0, notEvaluable: 0 });
    expect(report.organizationId).toBe(ORG);
    expect(report.asAtDate).toBe('2025-12-31');
    expect(report.results).toHaveLength(9);
    // Aucune recommandation quand tout est conforme.
    expect(report.results.every((r) => r.recommendation === null)).toBe(true);
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

  it('detects accounts with an abnormal balance sense (probable misposting)', async () => {
    const { service, reports } = setup({
      trialBalanceRows: [
        {
          accountCode: '401100',
          accountLabel: 'Fournisseur ABC',
          endingDebit: '500.00',
          endingCredit: '0.00',
        },
        {
          accountCode: '521000',
          accountLabel: 'Banque',
          endingDebit: '1000.00',
          endingCredit: '0.00',
        },
      ],
    });

    const report = await service.evaluate(ORG, QUERY);
    const sense = report.results.find((r) => r.controlId === 'plan-sens-normal-comptes');

    expect(reports.getTrialBalance).toHaveBeenCalledWith(ORG, {
      fromDate: QUERY.fiscalYearStartDate,
      toDate: QUERY.asAtDate,
    });
    expect(sense?.status).toBe('fail');
    expect(sense?.domain).toBe('accounting-plan');
    expect(sense?.data).toMatchObject({ warningCount: 1 });
    expect((sense?.data as { accounts: Array<{ code: string }> }).accounts[0].code).toBe('401100');
    // Sens anormal = contrôle 'warning' → réserve, pas non-conformité.
    expect(report.verdict).toBe('partial');
  });

  it('surfaces the catalog remediation as a recommendation on a detected anomaly', async () => {
    const { service } = setup({
      trialBalanceRows: [
        {
          accountCode: '411200',
          accountLabel: 'Client XYZ',
          endingDebit: '0.00',
          endingCredit: '750.00',
        },
      ],
    });

    const report = await service.evaluate(ORG, QUERY);

    const sense = report.results.find((r) => r.controlId === 'plan-sens-normal-comptes');
    expect(sense?.status).toBe('fail');
    // La recommandation provient du remède du contrôle catalogue.
    expect(sense?.recommendation).toBe('Corriger plan-sens-normal-comptes');

    // Un contrôle qui passe n'expose aucune recommandation.
    const bilan = report.results.find((r) => r.controlId === 'bilan-actif-egal-passif');
    expect(bilan?.status).toBe('pass');
    expect(bilan?.recommendation).toBeNull();
  });

  it('detects accounts whose code is outside the SYSCOHADA chart (import garbage)', async () => {
    const { service } = setup({
      trialBalanceRows: [
        {
          accountCode: '601000',
          accountLabel: 'Achats',
          endingDebit: '100.00',
          endingCredit: '0.00',
        },
        {
          accountCode: '0DIVERS',
          accountLabel: 'Compte parasite',
          endingDebit: '50.00',
          endingCredit: '0.00',
        },
      ],
    });

    const report = await service.evaluate(ORG, QUERY);
    const numbering = report.results.find((r) => r.controlId === 'plan-numerotation-classes');

    expect(numbering?.status).toBe('fail');
    expect(numbering?.data).toMatchObject({ invalidCount: 1 });
    expect((numbering?.data as { accounts: Array<{ code: string }> }).accounts[0].code).toBe(
      '0DIVERS',
    );
    expect(numbering?.recommendation).toBe('Corriger plan-numerotation-classes');
  });

  it('detects validated entries dated outside their accounting period', async () => {
    const { service, dataSource } = setup({
      outOfPeriodRows: [
        {
          entry_number: '42',
          entry_date: '2025-02-15',
          start_date: '2025-01-01',
          end_date: '2025-01-31',
        },
      ],
    });

    const report = await service.evaluate(ORG, QUERY);
    const chrono = report.results.find((r) => r.controlId === 'journal-chronologie-continuite');

    // La requête de cohérence de période a bien été routée vers accounting_periods.
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringMatching(/accounting_periods/), [
      ORG,
      QUERY.fiscalYearStartDate,
      QUERY.asAtDate,
    ]);
    expect(chrono?.status).toBe('fail');
    expect(chrono?.data).toMatchObject({ outOfPeriodCount: 1 });
    expect(chrono?.domain).toBe('journals');
    expect(chrono?.recommendation).toBe('Corriger journal-chronologie-continuite');
    // Chronologie = contrôle 'warning' → réserve.
    expect(report.verdict).toBe('partial');
  });

  it('detects unsettled suspense / internal-transfer accounts at the cut-off date', async () => {
    const { service } = setup({
      trialBalanceRows: [
        {
          accountCode: '471000',
          accountLabel: "Compte d'attente",
          endingDebit: '320.00',
          endingCredit: '0.00',
        },
        {
          accountCode: '476000',
          accountLabel: 'Écart de conversion-Actif',
          endingDebit: '90.00',
          endingCredit: '0.00',
        },
      ],
    });

    const report = await service.evaluate(ORG, QUERY);
    const suspense = report.results.find((r) => r.controlId === 'comptes-attente-soldes');

    expect(suspense?.status).toBe('fail');
    expect(suspense?.domain).toBe('regularizations');
    // 471 signalé, 476 (écart de conversion) ignoré → un seul compte.
    expect(suspense?.data).toMatchObject({ openCount: 1 });
    expect((suspense?.data as { accounts: Array<{ code: string }> }).accounts[0].code).toBe(
      '471000',
    );
    expect(suspense?.recommendation).toBe('Corriger comptes-attente-soldes');
    // Comptes d'attente = contrôle 'warning' → réserve.
    expect(report.verdict).toBe('partial');
  });

  it('detects VAT accounts posted on the wrong side (443 debtor / 445 creditor)', async () => {
    const { service } = setup({
      trialBalanceRows: [
        {
          accountCode: '443100',
          accountLabel: 'TVA facturée',
          endingDebit: '200.00',
          endingCredit: '0.00',
        },
        {
          accountCode: '445100',
          accountLabel: 'TVA récupérable',
          endingDebit: '500.00',
          endingCredit: '0.00',
        },
      ],
    });

    const report = await service.evaluate(ORG, QUERY);
    const tva = report.results.find((r) => r.controlId === 'tva-coherence-comptes');

    expect(tva?.status).toBe('fail');
    // Seul 443 débiteur est anormal (445 débiteur est normal).
    expect(tva?.data).toMatchObject({ anomalyCount: 1 });
    expect(tva?.recommendation).toBe('Corriger tva-coherence-comptes');
    // TVA = contrôle 'warning' → réserve, pas non-conformité.
    expect(report.verdict).toBe('partial');
  });

  it('flags prior-year unlettered partner lines as an informational finding', async () => {
    const { service, dataSource } = setup({
      letteringRows: [
        { code: '401000', cnt: '7' },
        { code: '411000', cnt: '3' },
      ],
    });

    const report = await service.evaluate(ORG, QUERY);
    const lettering = report.results.find((r) => r.controlId === 'journal-lettrage-tiers');

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringMatching(/organization_chart_accounts/),
      [ORG, QUERY.fiscalYearStartDate],
    );
    expect(lettering?.status).toBe('fail');
    expect(lettering?.data).toMatchObject({ unletteredCount: 10 });
    expect(lettering?.recommendation).toBe('Corriger journal-lettrage-tiers');
    // Lettrage = contrôle 'info' → réserve seulement, jamais non-conformité.
    expect(report.verdict).toBe('partial');
  });

  it('stays non_compliant only when a BLOCKING control fails, alongside warnings', async () => {
    const { service } = setup({
      // Bilan déséquilibré (bloquant) + sens anormal (warning) simultanés.
      balanceTotals: { actif: '1000.00', passif: '900.00', difference: '100.00' },
      trialBalanceRows: [
        {
          accountCode: '401100',
          accountLabel: 'Fournisseur',
          endingDebit: '500.00',
          endingCredit: '0.00',
        },
      ],
    });

    const report = await service.evaluate(ORG, QUERY);

    expect(report.results.find((r) => r.controlId === 'bilan-actif-egal-passif')?.status).toBe(
      'fail',
    );
    expect(report.results.find((r) => r.controlId === 'plan-sens-normal-comptes')?.status).toBe(
      'fail',
    );
    // Un bloquant en échec l'emporte → non conforme.
    expect(report.verdict).toBe('non_compliant');
  });
});
