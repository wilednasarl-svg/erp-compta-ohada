import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { ReportsRepository } from '../repositories/reports.repository';
import {
  CashFlowService,
  BFR_EXCLUDED_PREFIXES,
  type PeriodMovement,
  type SignedAccountBalance,
} from '../services/cash-flow.service';
import type { ReportsService, SigReport } from '../services/reports.service';

const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');

interface BalanceRow {
  accountId: string;
  accountCode: string;
  accountLabel: string;
  accountClass: number;
  isOpposing: boolean;
  totalDebit: string;
  totalCredit: string;
}

function row(over: Partial<BalanceRow>): BalanceRow {
  return {
    accountId: `a-${over.accountCode ?? '0'}`,
    accountCode: '0',
    accountLabel: '',
    accountClass: 0,
    isOpposing: false,
    totalDebit: '0.00',
    totalCredit: '0.00',
    ...over,
  };
}

function trialRow(over: { accountCode: string; periodDebit?: string; periodCredit?: string }) {
  return {
    accountId: `a-${over.accountCode}`,
    accountCode: over.accountCode,
    accountLabel: '',
    accountClass: Number(over.accountCode[0]) || 0,
    openingDebit: '0.00',
    openingCredit: '0.00',
    periodDebit: over.periodDebit ?? '0.00',
    periodCredit: over.periodCredit ?? '0.00',
    endingDebit: '0.00',
    endingCredit: '0.00',
  };
}

function buildSig(over: {
  XD?: string;
  XF?: string;
  TO?: string;
  RP?: string;
  RQ?: string;
  RS?: string;
}): SigReport {
  return {
    fromDate: '2026-01-01',
    toDate: '2026-12-31',
    charges: [
      { code: 'RP', label: 'Autres charges HAO', side: 'CHARGE', amount: over.RP ?? '0.00' },
      {
        code: 'RQ',
        label: 'Participation travailleurs',
        side: 'CHARGE',
        amount: over.RQ ?? '0.00',
      },
      { code: 'RS', label: 'Impôts sur résultat', side: 'CHARGE', amount: over.RS ?? '0.00' },
    ],
    produits: [
      { code: 'TO', label: 'Autres produits HAO', side: 'PRODUIT', amount: over.TO ?? '0.00' },
    ],
    soldes: [
      { code: 'XD', label: 'EBE', formula: '', amount: over.XD ?? '0.00' },
      { code: 'XF', label: 'Résultat financier', formula: '', amount: over.XF ?? '0.00' },
    ],
  };
}

function buildHarness(opts: {
  balancesAtToDate?: BalanceRow[];
  balancesAtN1?: BalanceRow[];
  movements?: ReturnType<typeof trialRow>[];
  sig?: SigReport;
}) {
  const repo = {
    trialBalance: jest.fn().mockResolvedValue(opts.movements ?? []),
    generalLedger: jest.fn(),
    generalLedgerOpening: jest.fn(),
    accountBalancesAsAt: jest.fn().mockImplementation(async (_org: string, asAt: string) => {
      if (asAt === '2026-12-31') return opts.balancesAtToDate ?? [];
      return opts.balancesAtN1 ?? [];
    }),
  };
  const reports = {
    getSig: jest.fn().mockResolvedValue(opts.sig ?? buildSig({})),
  };
  const service = new CashFlowService(
    repo as unknown as ReportsRepository,
    reports as unknown as ReportsService,
  );
  return { service, repo, reports };
}

// ────────────────────────────────────────────────────────────────────
// 1. CAFG (FA)
// ────────────────────────────────────────────────────────────────────
describe('CashFlowService — CAFG (FA)', () => {
  it('applique la formule FA = XD + 654 - 754 + XF + TO + RP + RQ + RS', async () => {
    const h = buildHarness({
      sig: buildSig({
        XD: '10000.00',
        XF: '500.00',
        TO: '300.00',
        RP: '200.00',
        RQ: '100.00',
        RS: '400.00',
      }),
      movements: [
        trialRow({ accountCode: '654000', periodDebit: '150.00', periodCredit: '0.00' }),
        trialRow({ accountCode: '754000', periodDebit: '0.00', periodCredit: '50.00' }),
      ],
    });

    const result = await h.service.getCashFlow(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });

    const fa = result.operatingFlows.postes.find((p) => p.code === 'FA');
    // FA = 10000 + 150 - 50 + 500 + 300 + 200 + 100 + 400 = 11600
    expect(fa?.amount).toBe('11600.00');
  });

  it('FA = 0 quand tous les composants sont nuls', async () => {
    const h = buildHarness({});
    const result = await h.service.getCashFlow(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    expect(result.operatingFlows.postes.find((p) => p.code === 'FA')?.amount).toBe('0.00');
  });
});

// ────────────────────────────────────────────────────────────────────
// 2. Δ BFR exclut les comptes interdits
// ────────────────────────────────────────────────────────────────────
describe('CashFlowService — exclusions BFR', () => {
  const allExcludedCodes = [
    '485',
    '414',
    '467',
    '458',
    '4581',
    '4582',
    '4494',
    '4751',
    '4752',
    '404',
    '481',
    '482',
    '472',
    '465',
  ];

  it.each(allExcludedCodes)('le compte %s ne contribue PAS aux variations FD/FE', async (code) => {
    const balancesN: BalanceRow[] = [
      row({ accountCode: code, totalDebit: '1000.00', totalCredit: '0.00' }),
      row({ accountCode: '411000', totalDebit: '500.00', totalCredit: '0.00' }),
    ];
    const balancesN1: BalanceRow[] = [
      row({ accountCode: code, totalDebit: '0.00', totalCredit: '0.00' }),
      row({ accountCode: '411000', totalDebit: '500.00', totalCredit: '0.00' }),
    ];
    const h = buildHarness({
      balancesAtToDate: balancesN,
      balancesAtN1: balancesN1,
    });

    const result = await h.service.getCashFlow(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });

    const fd = Number(result.operatingFlows.postes.find((p) => p.code === 'FD')?.amount);
    const fe = Number(result.operatingFlows.postes.find((p) => p.code === 'FE')?.amount);
    expect(fd).toBe(0);
    expect(fe).toBe(0);
  });

  it('inclut bien le compte 411 (créance client ordinaire) dans FD', async () => {
    const h = buildHarness({
      balancesAtToDate: [
        row({ accountCode: '411000', totalDebit: '1000.00', totalCredit: '0.00' }),
      ],
      balancesAtN1: [row({ accountCode: '411000', totalDebit: '600.00', totalCredit: '0.00' })],
    });
    const result = await h.service.getCashFlow(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    // FD = - Δcréances. Créance ↑ de 400 → FD = -400.
    const fd = Number(result.operatingFlows.postes.find((p) => p.code === 'FD')?.amount);
    expect(fd).toBe(-400);
  });

  it("inclut bien le compte 401 (fournisseur d'exploitation) dans FE", async () => {
    const h = buildHarness({
      balancesAtToDate: [row({ accountCode: '401000', totalDebit: '0.00', totalCredit: '800.00' })],
      balancesAtN1: [row({ accountCode: '401000', totalDebit: '0.00', totalCredit: '500.00' })],
    });
    const result = await h.service.getCashFlow(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    // FE = + Δdettes. Dette ↑ de 300 → FE = +300.
    const fe = Number(result.operatingFlows.postes.find((p) => p.code === 'FE')?.amount);
    expect(fe).toBe(300);
  });

  it('le helper isExcludedFromBfr renvoie true pour les 14 préfixes interdits', () => {
    for (const code of allExcludedCodes) {
      expect(CashFlowService.isExcludedFromBfr(code)).toBe(true);
    }
  });

  it('le helper isExcludedFromBfr renvoie false pour les comptes ordinaires', () => {
    expect(CashFlowService.isExcludedFromBfr('411000')).toBe(false);
    expect(CashFlowService.isExcludedFromBfr('401000')).toBe(false);
    expect(CashFlowService.isExcludedFromBfr('421000')).toBe(false);
    expect(CashFlowService.isExcludedFromBfr('445000')).toBe(false);
  });

  it('export BFR_EXCLUDED_PREFIXES contient les 14 préfixes documentés', () => {
    expect(BFR_EXCLUDED_PREFIXES).toEqual(
      expect.arrayContaining([
        '485',
        '414',
        '467',
        '458',
        '4494',
        '4751',
        '4752',
        '404',
        '481',
        '482',
        '472',
      ]),
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// 3. Trésorerie ouverture (ZA) / clôture (ZH)
// ────────────────────────────────────────────────────────────────────
describe('CashFlowService — trésorerie nette (ZA / ZH)', () => {
  it('netTreasury somme les classes 5x (débit positif, crédit négatif via signed)', () => {
    const signed: SignedAccountBalance[] = [
      { accountCode: '521000', net: 5000 },
      { accountCode: '521100', net: -2000 },
      { accountCode: '571000', net: 300 },
      { accountCode: '411000', net: 10000 }, // exclu
      { accountCode: '590000', net: -100 }, // 59 exclu
    ];
    expect(CashFlowService.netTreasury(signed)).toBe(5000 - 2000 + 300);
  });

  it('isTreasuryAccount filtre 50-58 mais exclut 59', () => {
    expect(CashFlowService.isTreasuryAccount('512000')).toBe(true);
    expect(CashFlowService.isTreasuryAccount('571000')).toBe(true);
    expect(CashFlowService.isTreasuryAccount('590000')).toBe(false);
    expect(CashFlowService.isTreasuryAccount('411000')).toBe(false);
  });

  it('openingCash (ZA) calculé à partir des balances N-1 ; ZH = ZA + ZG', async () => {
    // EBE 2500 → FA=2500 → ZB=2500. Pas d'activité invest/fin → ZG=2500.
    // ZA = 1000 (compte 521 N-1). ZH = ZA + ZG = 3500.
    // Trésorerie réelle à toDate = 3500. coherenceCheck ~ 0.
    const h = buildHarness({
      balancesAtN1: [row({ accountCode: '521000', totalDebit: '1000.00', totalCredit: '0.00' })],
      balancesAtToDate: [
        row({ accountCode: '521000', totalDebit: '3500.00', totalCredit: '0.00' }),
      ],
      sig: buildSig({ XD: '2500.00' }),
    });
    const result = await h.service.getCashFlow(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    expect(result.openingCash).toBe('1000.00');
    expect(result.closingCash).toBe('3500.00');
    expect(result.netCashVariation).toBe('2500.00');
    expect(Math.abs(Number(result.coherenceCheck))).toBeLessThan(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// 4. Cohérence finale : ZH calculé ≈ trésorerie comptes 5x à toDate
// ────────────────────────────────────────────────────────────────────
describe('CashFlowService — cohérence ZH ≈ trésorerie comptes 5x', () => {
  it('sur un dataset trivial sans activité, écart de cohérence = 0', async () => {
    const h = buildHarness({});
    const result = await h.service.getCashFlow(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    expect(Math.abs(Number(result.coherenceCheck))).toBeLessThan(1);
  });

  it('sur un dataset équilibré (vente cash), cohérence ~ 0', async () => {
    // Vente 1000 cash. EBE = 1000. Pas de variation BFR.
    // ZA = 0, ZH = 1000, ZG = ZB = FA = 1000. Cohérence = 0.
    const h = buildHarness({
      sig: buildSig({ XD: '1000.00' }),
      balancesAtN1: [],
      balancesAtToDate: [
        row({ accountCode: '521000', totalDebit: '1000.00', totalCredit: '0.00' }),
      ],
    });
    const result = await h.service.getCashFlow(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    expect(Math.abs(Number(result.coherenceCheck))).toBeLessThan(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// 5. Smoke test : nomenclature complète Z + F
// ────────────────────────────────────────────────────────────────────
describe('CashFlowService — smoke test nomenclature doctrine p.34', () => {
  it('expose 4 sections (ZB/ZC/ZD/ZE), 17 postes (FA-FQ), + ZA/ZF/ZG/ZH', async () => {
    const balancesN1: BalanceRow[] = [
      row({ accountCode: '521000', totalDebit: '5000.00', totalCredit: '0.00' }),
      row({ accountCode: '101000', totalDebit: '0.00', totalCredit: '10000.00' }),
      row({ accountCode: '161000', totalDebit: '0.00', totalCredit: '8000.00' }),
      row({ accountCode: '215000', totalDebit: '12000.00', totalCredit: '0.00' }),
      row({ accountCode: '311000', totalDebit: '2000.00', totalCredit: '0.00' }),
      row({ accountCode: '411000', totalDebit: '1500.00', totalCredit: '0.00' }),
      row({ accountCode: '401000', totalDebit: '0.00', totalCredit: '1000.00' }),
      row({ accountCode: '141000', totalDebit: '0.00', totalCredit: '500.00' }),
      row({ accountCode: '485000', totalDebit: '300.00', totalCredit: '0.00' }),
    ];
    const balancesN: BalanceRow[] = [
      row({ accountCode: '521000', totalDebit: '8000.00', totalCredit: '0.00' }),
      row({ accountCode: '101000', totalDebit: '0.00', totalCredit: '12000.00' }),
      row({ accountCode: '161000', totalDebit: '0.00', totalCredit: '7000.00' }),
      row({ accountCode: '215000', totalDebit: '15000.00', totalCredit: '0.00' }),
      row({ accountCode: '311000', totalDebit: '2500.00', totalCredit: '0.00' }),
      row({ accountCode: '411000', totalDebit: '2000.00', totalCredit: '0.00' }),
      row({ accountCode: '401000', totalDebit: '0.00', totalCredit: '1300.00' }),
      row({ accountCode: '141000', totalDebit: '0.00', totalCredit: '800.00' }),
      row({ accountCode: '485000', totalDebit: '700.00', totalCredit: '0.00' }),
    ];
    const movements = [
      trialRow({ accountCode: '215000', periodDebit: '3000.00', periodCredit: '0.00' }),
      trialRow({ accountCode: '161000', periodDebit: '1000.00', periodCredit: '0.00' }),
      trialRow({ accountCode: '101000', periodDebit: '0.00', periodCredit: '2000.00' }),
    ];

    const h = buildHarness({
      balancesAtN1: balancesN1,
      balancesAtToDate: balancesN,
      movements,
      sig: buildSig({ XD: '4000.00' }),
    });

    const result = await h.service.getCashFlow(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });

    // Structure conforme doctrine p. 34 : 4 sections de détail
    expect(result.operatingFlows.code).toBe('ZB');
    expect(result.investingFlows.code).toBe('ZC');
    expect(result.financingFlowsEquity.code).toBe('ZD');
    expect(result.financingFlowsDebt.code).toBe('ZE');

    // Postes : FA-FE (5) + FF-FJ (5) + FK-FN (4) + FO-FQ (3) = 17 postes
    const allPostes = [
      ...result.operatingFlows.postes,
      ...result.investingFlows.postes,
      ...result.financingFlowsEquity.postes,
      ...result.financingFlowsDebt.postes,
    ];
    expect(allPostes).toHaveLength(17);
    const expectedCodes = [
      'FA',
      'FB',
      'FC',
      'FD',
      'FE',
      'FF',
      'FG',
      'FH',
      'FI',
      'FJ',
      'FK',
      'FL',
      'FM',
      'FN',
      'FO',
      'FP',
      'FQ',
    ];
    expect(allPostes.map((p) => p.code)).toEqual(expectedCodes);

    // Trésorerie : ZA = 5000 (compte 521 ouverture).
    // ZH calculé = ZA + ZG (somme des flux). coherenceCheck = ZH − trésorerie réelle.
    expect(result.openingCash).toBe('5000.00');
    // ZG est cohérent avec la somme des sous-totaux.
    const zb = Number(result.operatingFlows.subtotal);
    const zc = Number(result.investingFlows.subtotal);
    const zf = Number(result.financingFlowsTotal);
    const zg = Number(result.netCashVariation);
    expect(Math.abs(zb + zc + zf - zg)).toBeLessThan(0.01);
    // ZH = ZA + ZG par construction.
    expect(Number(result.closingCash)).toBeCloseTo(5000 + zg, 2);

    // Le compte exclu 485 (Δ +400) ne contribue PAS à FD/FE.
    const fd = Number(result.operatingFlows.postes.find((p) => p.code === 'FD')?.amount);
    expect(fd).toBe(-500);
  });

  it('comparatif N-1 quand previousFromDate / previousToDate fournis', async () => {
    const h = buildHarness({});
    const result = await h.service.getCashFlow(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      previousFromDate: '2025-01-01',
      previousToDate: '2025-12-31',
    });
    expect(result.previous).toBeDefined();
    expect(result.previous?.fromDate).toBe('2025-01-01');
    expect(result.previous?.toDate).toBe('2025-12-31');
    // Comparatif expose les sous-totaux ZB/ZC/ZD/ZE/ZF
    expect(result.previous?.operatingFlow).toBeDefined();
    expect(result.previous?.investingFlow).toBeDefined();
    expect(result.previous?.financingFlowEquity).toBeDefined();
    expect(result.previous?.financingFlowDebt).toBeDefined();
    expect(result.previous?.financingFlowTotal).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// 6. Doctrine p.34 : nomenclature stricte ZA..ZH
// ────────────────────────────────────────────────────────────────────
describe('CashFlowService — codes Z conformes doctrine p.34', () => {
  it('expose openingCash (ZA), closingCash (ZH), netCashVariation (ZG)', async () => {
    const h = buildHarness({});
    const result = await h.service.getCashFlow(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    expect(typeof result.openingCash).toBe('string'); // ZA
    expect(typeof result.closingCash).toBe('string'); // ZH
    expect(typeof result.netCashVariation).toBe('string'); // ZG
    expect(typeof result.financingFlowsTotal).toBe('string'); // ZF
  });

  it('ZF = ZD + ZE (sous-total financement)', async () => {
    const h = buildHarness({
      movements: [
        trialRow({ accountCode: '161000', periodDebit: '0.00', periodCredit: '5000.00' }), // FO
        trialRow({ accountCode: '465000', periodDebit: '2000.00', periodCredit: '0.00' }), // FN
      ],
    });
    const result = await h.service.getCashFlow(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    const zd = Number(result.financingFlowsEquity.subtotal);
    const ze = Number(result.financingFlowsDebt.subtotal);
    const zf = Number(result.financingFlowsTotal);
    expect(Math.abs(zd + ze - zf)).toBeLessThan(0.01);
  });

  it('ZG = ZB + ZC + ZF (variation totale)', async () => {
    const h = buildHarness({
      sig: buildSig({ XD: '1000.00' }),
    });
    const result = await h.service.getCashFlow(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    const zb = Number(result.operatingFlows.subtotal);
    const zc = Number(result.investingFlows.subtotal);
    const zf = Number(result.financingFlowsTotal);
    const zg = Number(result.netCashVariation);
    expect(Math.abs(zb + zc + zf - zg)).toBeLessThan(0.01);
  });

  it('ZH = ZA + ZG (trésorerie clôture)', async () => {
    const h = buildHarness({
      sig: buildSig({ XD: '500.00' }),
      balancesAtN1: [row({ accountCode: '521000', totalDebit: '2000.00', totalCredit: '0.00' })],
      balancesAtToDate: [
        row({ accountCode: '521000', totalDebit: '2500.00', totalCredit: '0.00' }),
      ],
    });
    const result = await h.service.getCashFlow(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    const za = Number(result.openingCash);
    const zg = Number(result.netCashVariation);
    const zh = Number(result.closingCash);
    expect(Math.abs(za + zg - zh)).toBeLessThan(0.01);
  });
});

// ────────────────────────────────────────────────────────────────────
// 7. Validations
// ────────────────────────────────────────────────────────────────────
describe('CashFlowService — validations', () => {
  it('rejette REPORT_INVALID_DATE_RANGE si fromDate > toDate', async () => {
    const h = buildHarness({});
    await expect(
      h.service.getCashFlow(ORG_ID, {
        fromDate: '2026-12-31',
        toDate: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: 'REPORT_INVALID_DATE_RANGE' });
  });

  it('rejette REPORT_INVALID_DATE_RANGE sur format invalide', async () => {
    const h = buildHarness({});
    await expect(
      h.service.getCashFlow(ORG_ID, {
        fromDate: '01-01-2026',
        toDate: '2026-12-31',
      }),
    ).rejects.toMatchObject({ code: 'REPORT_INVALID_DATE_RANGE' });
  });
});

// ────────────────────────────────────────────────────────────────────
// 8. Helpers unitaires
// ────────────────────────────────────────────────────────────────────
describe('CashFlowService — helpers statiques', () => {
  it('dayBefore renvoie le jour précédent en YYYY-MM-DD', () => {
    expect(CashFlowService.dayBefore('2026-01-01')).toBe('2025-12-31');
    expect(CashFlowService.dayBefore('2026-03-01')).toBe('2026-02-28');
  });

  it('toSignedBalances inverse le signe pour isOpposing=true', () => {
    const result = CashFlowService.toSignedBalances([
      { accountCode: '411000', totalDebit: '1000.00', totalCredit: '0.00', isOpposing: false },
      { accountCode: '491000', totalDebit: '0.00', totalCredit: '200.00', isOpposing: true },
    ]);
    expect(result[0]).toEqual({ accountCode: '411000', net: 1000 });
    expect(result[1]).toEqual({ accountCode: '491000', net: 200 });
  });

  it('sumPeriodForPrefix direction debit-credit', () => {
    const m: PeriodMovement[] = [
      { accountCode: '654000', debit: 500, credit: 0 },
      { accountCode: '654100', debit: 200, credit: 50 },
      { accountCode: '601000', debit: 999, credit: 0 },
    ];
    expect(CashFlowService.sumPeriodForPrefix(m, '654', 'debit-credit')).toBe(500 + 200 - 50);
  });

  it('sumDebitForPrefixes avec extra filter', () => {
    const m: PeriodMovement[] = [
      { accountCode: '215000', debit: 1000, credit: 0 },
      { accountCode: '281500', debit: 500, credit: 0 },
      { accountCode: '291500', debit: 100, credit: 0 },
    ];
    const sum = CashFlowService.sumDebitForPrefixes(
      m,
      ['20', '21', '22', '23', '24', '25', '26', '27'],
      (code) => !code.startsWith('28') && !code.startsWith('29'),
    );
    expect(sum).toBe(1000);
  });

  it('postesReferentiel expose 25 entrées (8 Z + 17 F)', () => {
    expect(CashFlowService.postesReferentiel.length).toBe(25);
  });
});
