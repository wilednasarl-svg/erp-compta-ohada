import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { OrganizationAccountRepository } from '../../accounting-plan/repositories/organization-account.repository';
import type {
  GeneralLedgerRow,
  ReportsRepository,
  TrialBalanceRow,
} from '../repositories/reports.repository';
import { ReportsService } from '../services/reports.service';

const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
const ACC_ID = '00000000-0000-4000-8000-000000000010';

function buildHarness() {
  const repo = {
    trialBalance: jest.fn(),
    periodValidity: jest.fn(),
    generalLedger: jest.fn(),
    generalLedgerOpening: jest
      .fn()
      .mockResolvedValue({ openingDebit: '0.00', openingCredit: '0.00' }),
    accountBalancesAsAt: jest.fn().mockResolvedValue([]),
  };
  const accounts = {
    findById: jest.fn().mockResolvedValue({
      id: ACC_ID,
      code: '411000',
      label: 'CLIENT X',
      class: 4,
    }),
  };
  const service = new ReportsService(
    repo as unknown as ReportsRepository,
    accounts as unknown as OrganizationAccountRepository,
  );
  return { service, repo, accounts };
}

function tbRow(over: Partial<TrialBalanceRow> = {}): TrialBalanceRow {
  return {
    accountId: 'a-1',
    accountCode: '411000',
    accountLabel: 'CLIENT X',
    accountClass: 4,
    openingDebit: '0.00',
    openingCredit: '0.00',
    periodDebit: '0.00',
    periodCredit: '0.00',
    endingDebit: '0.00',
    endingCredit: '0.00',
    ...over,
  };
}

describe('ReportsService.getTrialBalance', () => {
  it('passes the filters through to the repo and projects rows + totals', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValue([
      tbRow({
        accountCode: '411000',
        periodDebit: '1000.00',
        periodCredit: '0.00',
        endingDebit: '1000.00',
        endingCredit: '0.00',
      }),
      tbRow({
        accountId: 'a-2',
        accountCode: '707000',
        accountClass: 7,
        periodDebit: '0.00',
        periodCredit: '1000.00',
        endingDebit: '0.00',
        endingCredit: '1000.00',
      }),
    ]);

    const result = await h.service.getTrialBalance(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      accountClass: 4,
    });

    expect(h.repo.trialBalance).toHaveBeenCalledWith(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      accountClass: 4,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.totals).toEqual({
      openingDebit: '0.00',
      openingCredit: '0.00',
      periodDebit: '1000.00',
      periodCredit: '1000.00',
      endingDebit: '1000.00',
      endingCredit: '1000.00',
    });
  });

  it('hideEmpty drops accounts whose opening + period are all zero', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValue([
      tbRow({ accountCode: '411000', periodDebit: '500.00' }),
      tbRow({ accountId: 'a-2', accountCode: '512000' }), // all zeros
    ]);

    const result = await h.service.getTrialBalance(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      hideEmpty: true,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].accountCode).toBe('411000');
  });

  it('rejects with REPORT_INVALID_DATE_RANGE when fromDate > toDate', async () => {
    const h = buildHarness();
    await expect(
      h.service.getTrialBalance(ORG_ID, {
        fromDate: '2026-12-31',
        toDate: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: 'REPORT_INVALID_DATE_RANGE' });
    expect(h.repo.trialBalance).not.toHaveBeenCalled();
  });

  it('rejects with REPORT_INVALID_DATE_RANGE on malformed dates', async () => {
    const h = buildHarness();
    await expect(
      h.service.getTrialBalance(ORG_ID, { fromDate: '2026-1-1', toDate: '2026-12-31' }),
    ).rejects.toMatchObject({ code: 'REPORT_INVALID_DATE_RANGE' });
  });
});

describe('ReportsService.getGeneralLedger', () => {
  function ledgerRow(over: Partial<GeneralLedgerRow> = {}): GeneralLedgerRow {
    return {
      lineId: 'l-1',
      entryId: 'e-1',
      entryDate: '2026-02-15',
      journalCode: 'VTE',
      entryNumber: 1,
      description: 'Facture A',
      debit: '0.00',
      credit: '0.00',
      letteringCode: null,
      ...over,
    };
  }

  it('computes runningBalance from opening + chronological debits/credits', async () => {
    const h = buildHarness();
    h.repo.generalLedgerOpening.mockResolvedValue({
      openingDebit: '500.00',
      openingCredit: '0.00',
    });
    h.repo.generalLedger.mockResolvedValue([
      ledgerRow({ lineId: 'l-1', entryDate: '2026-02-15', debit: '200.00' }),
      ledgerRow({ lineId: 'l-2', entryDate: '2026-03-01', credit: '100.00' }),
      ledgerRow({ lineId: 'l-3', entryDate: '2026-03-10', debit: '50.00' }),
    ]);

    const result = await h.service.getGeneralLedger(ORG_ID, {
      accountId: ACC_ID,
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });

    expect(result.opening).toEqual({
      openingDebit: '500.00',
      openingCredit: '0.00',
      openingBalance: '500.00',
      openingBalanceSide: 'D',
    });
    expect(result.lines.map((l) => l.runningBalance)).toEqual(['700.00', '600.00', '650.00']);
    expect(result.lines.map((l) => l.runningBalanceSide)).toEqual(['D', 'D', 'D']);
    expect(result.lines.map((l) => l.runningBalanceAbs)).toEqual(['700.00', '600.00', '650.00']);
    expect(result.totals).toEqual({
      periodDebit: '250.00',
      periodCredit: '100.00',
      endingDebit: '650.00',
      endingCredit: '0.00',
      closingBalance: '650.00',
      closingBalanceSide: 'D',
    });
  });

  it('flips runningBalanceSide D → C when the cumulative balance crosses zero', async () => {
    const h = buildHarness();
    h.repo.generalLedgerOpening.mockResolvedValue({
      openingDebit: '100.00',
      openingCredit: '0.00',
    });
    h.repo.generalLedger.mockResolvedValue([
      ledgerRow({ lineId: 'l-1', entryDate: '2026-02-01', debit: '50.00' }), // +150 D
      ledgerRow({ lineId: 'l-2', entryDate: '2026-03-01', credit: '200.00' }), // -50 C
      ledgerRow({ lineId: 'l-3', entryDate: '2026-04-01', credit: '100.00' }), // -150 C
    ]);

    const result = await h.service.getGeneralLedger(ORG_ID, {
      accountId: ACC_ID,
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });

    expect(result.opening.openingBalanceSide).toBe('D');
    expect(result.lines.map((l) => l.runningBalanceSide)).toEqual(['D', 'C', 'C']);
    expect(result.lines.map((l) => l.runningBalanceAbs)).toEqual(['150.00', '50.00', '150.00']);
    expect(result.totals.closingBalance).toBe('150.00');
    expect(result.totals.closingBalanceSide).toBe('C');
  });

  it('exposes opening side C when the account opens in credit', async () => {
    const h = buildHarness();
    h.repo.generalLedgerOpening.mockResolvedValue({
      openingDebit: '0.00',
      openingCredit: '750.00',
    });
    h.repo.generalLedger.mockResolvedValue([]);

    const result = await h.service.getGeneralLedger(ORG_ID, {
      accountId: ACC_ID,
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });

    expect(result.opening.openingBalance).toBe('750.00');
    expect(result.opening.openingBalanceSide).toBe('C');
    expect(result.totals.closingBalance).toBe('750.00');
    expect(result.totals.closingBalanceSide).toBe('C');
  });

  it('returns endingCredit when the net balance is negative (credit-side account)', async () => {
    const h = buildHarness();
    h.repo.generalLedgerOpening.mockResolvedValue({
      openingDebit: '0.00',
      openingCredit: '300.00',
    });
    h.repo.generalLedger.mockResolvedValue([
      ledgerRow({ debit: '50.00' }),
      ledgerRow({ credit: '200.00' }),
    ]);

    const result = await h.service.getGeneralLedger(ORG_ID, {
      accountId: ACC_ID,
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });

    // opening = -300, +50 → -250, -200 → -450. Net = -450 → credit side.
    expect(result.totals.endingDebit).toBe('0.00');
    expect(result.totals.endingCredit).toBe('450.00');
  });

  it('returns 404 CHART_ACCOUNT_NOT_FOUND when the account is unknown in this tenant', async () => {
    const h = buildHarness();
    h.accounts.findById.mockResolvedValue(null);

    await expect(
      h.service.getGeneralLedger(ORG_ID, {
        accountId: ACC_ID,
        fromDate: '2026-01-01',
        toDate: '2026-12-31',
      }),
    ).rejects.toMatchObject({ code: 'CHART_ACCOUNT_NOT_FOUND' });
    expect(h.repo.generalLedger).not.toHaveBeenCalled();
  });

  it('rejects REPORT_INVALID_DATE_RANGE before hitting the DB', async () => {
    const h = buildHarness();
    await expect(
      h.service.getGeneralLedger(ORG_ID, {
        accountId: ACC_ID,
        fromDate: '2026-12-31',
        toDate: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: 'REPORT_INVALID_DATE_RANGE' });
    expect(h.accounts.findById).not.toHaveBeenCalled();
  });

  it('preserves the letteringCode on each line for the audit drill-down', async () => {
    const h = buildHarness();
    h.repo.generalLedger.mockResolvedValue([
      ledgerRow({ lineId: 'l-1', debit: '1000.00', letteringCode: 'A0001' }),
      ledgerRow({ lineId: 'l-2', credit: '1000.00', letteringCode: 'A0001' }),
    ]);
    const result = await h.service.getGeneralLedger(ORG_ID, {
      accountId: ACC_ID,
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    expect(result.lines.map((l) => l.letteringCode)).toEqual(['A0001', 'A0001']);
  });
});

describe('ReportsService static helpers', () => {
  it.each([
    ['2026-01-01', true],
    ['2026-1-1', false],
    ['2026/01/01', false],
    ['not a date', false],
    ['', false],
  ])('isYmd(%s) → %s', (input, expected) => {
    expect(ReportsService.isYmd(input)).toBe(expected);
  });
});

describe('ReportsService.getProfitLoss', () => {
  it('aggregates class 6 into charges sections and class 7 into produits sections', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValue([
      // Charges
      tbRow({
        accountId: 'a-60',
        accountCode: '601000',
        accountLabel: 'Achats',
        accountClass: 6,
        periodDebit: '5000.00',
        periodCredit: '0.00',
      }),
      tbRow({
        accountId: 'a-66',
        accountCode: '661000',
        accountLabel: 'Salaires',
        accountClass: 6,
        periodDebit: '8000.00',
        periodCredit: '0.00',
      }),
      // Produits
      tbRow({
        accountId: 'a-70',
        accountCode: '701000',
        accountLabel: 'Ventes',
        accountClass: 7,
        periodDebit: '0.00',
        periodCredit: '15000.00',
      }),
    ]);

    const result = await h.service.getProfitLoss(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });

    // Section '60' should contain the 601 account with 5000.00
    const section60 = result.charges.find((s) => s.code === '60');
    expect(section60?.amount).toBe('5000.00');
    expect(section60?.accounts[0]).toMatchObject({ code: '601000', amount: '5000.00' });

    const section66 = result.charges.find((s) => s.code === '66');
    expect(section66?.amount).toBe('8000.00');

    const section70 = result.produits.find((s) => s.code === '70');
    expect(section70?.amount).toBe('15000.00');

    expect(result.totalCharges).toBe('13000.00');
    expect(result.totalProduits).toBe('15000.00');
    expect(result.resultat).toBe('2000.00');
  });

  it('reports a loss when charges exceed produits (negative resultat)', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValue([
      tbRow({
        accountCode: '601000',
        accountClass: 6,
        periodDebit: '20000.00',
      }),
      tbRow({
        accountCode: '701000',
        accountClass: 7,
        periodCredit: '12000.00',
      }),
    ]);
    const result = await h.service.getProfitLoss(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    expect(result.resultat).toBe('-8000.00');
  });

  it('drops empty sections from the breakdown (only sections with movement are returned)', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValue([
      tbRow({ accountCode: '601000', accountClass: 6, periodDebit: '100.00' }),
    ]);
    const result = await h.service.getProfitLoss(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    // Section 60 has the account; section 61 (Transports) returns empty.
    const section61 = result.charges.find((s) => s.code === '61');
    expect(section61?.amount).toBe('0.00');
    expect(section61?.accounts).toHaveLength(0);
  });

  it('ignores classes 1-5 and 8-9 (P&L is strictly 6 + 7)', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValue([
      tbRow({ accountCode: '411000', accountClass: 4, periodDebit: '1000.00' }),
      tbRow({ accountCode: '811000', accountClass: 8, periodDebit: '500.00' }),
      tbRow({ accountCode: '601000', accountClass: 6, periodDebit: '300.00' }),
    ]);
    const result = await h.service.getProfitLoss(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    expect(result.totalCharges).toBe('300.00');
    expect(result.totalProduits).toBe('0.00');
  });

  // ── Séquence doctrinale Tome 3 p. 33 — SIG intercalés ────────────
  it('expose `lines` avec les 44 entrées Tome 3 p. 33 et SIG intercalés en cascade', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValue([
      tbRow({ accountCode: '701000', accountClass: 7, periodCredit: '110000000.00' }),
      tbRow({ accountCode: '601000', accountClass: 6, periodDebit: '75000000.00' }),
      tbRow({ accountCode: '603100', accountClass: 6, periodDebit: '5000000.00' }),
      tbRow({ accountCode: '661000', accountClass: 6, periodDebit: '20000000.00' }),
      tbRow({ accountCode: '891000', accountClass: 8, periodDebit: '3000000.00' }),
    ]);
    const result = await h.service.getProfitLoss(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    // 33 postes flux + 9 SIG = 42 lignes doctrinales (PL_POSTES).
    expect(result.lines).toHaveLength(42);

    // SIG calculés via la cascade Tome 3 p. 33 (montants signés).
    const byRef = (ref: string): string =>
      result.lines.find((l) => l.ref === ref)?.amountN ?? 'missing';
    // XA = TA(+110) + RA(-75) + RB(-5) = 30M
    expect(byRef('XA')).toBe('30000000.00');
    // XB = TA + TB + TC + TD = 110M
    expect(byRef('XB')).toBe('110000000.00');
    // XD = XC + RK (RK = -20M) — XC vaut 30M ici (mêmes 30M qu'XA en absence d'autres charges)
    expect(byRef('XD')).toBe('10000000.00');
    // XI = résultat net = 10M - 3M (RS=-3M) = 7M
    expect(byRef('XI')).toBe('7000000.00');

    // Ordre éditorial : TA < RA < RB < XA < TB < TC < TD < XB.
    const idx = (ref: string): number => result.lines.findIndex((l) => l.ref === ref);
    expect(idx('TA')).toBeLessThan(idx('RA'));
    expect(idx('RA')).toBeLessThan(idx('RB'));
    expect(idx('RB')).toBeLessThan(idx('XA'));
    expect(idx('XA')).toBeLessThan(idx('TB'));
    expect(idx('XH')).toBeLessThan(idx('RS'));
    expect(idx('RS')).toBeLessThan(idx('XI'));

    // Colonne « Note » : TA → 21, RA → 22, RB → 6.
    const noteOf = (ref: string): string | undefined =>
      result.lines.find((l) => l.ref === ref)?.note;
    expect(noteOf('TA')).toBe('21');
    expect(noteOf('RA')).toBe('22');
    expect(noteOf('RB')).toBe('6');
    expect(noteOf('RL')).toBe('3C&28');
    // Les SIG n'ont pas de Note (cellule vide).
    expect(noteOf('XA')).toBeUndefined();
    expect(noteOf('XI')).toBeUndefined();

    // Colonne « +/- » : produits = +, charges = -, variations = -/+, SIG = vide.
    const signOf = (ref: string): string | undefined =>
      result.lines.find((l) => l.ref === ref)?.sign;
    expect(signOf('TA')).toBe('+');
    expect(signOf('RA')).toBe('-');
    expect(signOf('RB')).toBe('-/+');
    expect(signOf('XA')).toBeUndefined();
    expect(signOf('XI')).toBeUndefined();
  });

  it('`lines` est présent même quand le CR est vide (référentiel complet)', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValue([]);
    const result = await h.service.getProfitLoss(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    expect(result.lines).toHaveLength(42);
    expect(result.lines.every((l) => l.amountN === '0.00')).toBe(true);

    // SIG XA..XI sont bien présents (intercalés en cascade).
    const sigCodes = result.lines.filter((l) => l.kind === 'SIG').map((l) => l.ref);
    expect(sigCodes).toEqual(['XA', 'XB', 'XC', 'XD', 'XE', 'XF', 'XG', 'XH', 'XI']);
  });
});

describe('ReportsService.getBalanceSheet', () => {
  function balancesAsAt(
    overrides: Array<{
      accountId?: string;
      accountCode: string;
      accountLabel: string;
      accountClass: number;
      isOpposing?: boolean;
      totalDebit: string;
      totalCredit: string;
    }>,
  ) {
    return overrides.map((o, i) => ({
      accountId: o.accountId ?? `acc-${i}`,
      accountCode: o.accountCode,
      accountLabel: o.accountLabel,
      accountClass: o.accountClass,
      isOpposing: o.isOpposing ?? false,
      totalDebit: o.totalDebit,
      totalCredit: o.totalCredit,
    }));
  }

  it('ventilates a typical post-import balance into ACTIF and PASSIF correctly', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest.fn().mockResolvedValue(
      balancesAsAt([
        // Actif immobilisé (cl. 2)
        {
          accountCode: '211000',
          accountLabel: 'Fonds commercial',
          accountClass: 2,
          totalDebit: '50000.00',
          totalCredit: '0.00',
        },
        // Stocks (cl. 3) → Actif circulant
        {
          accountCode: '311000',
          accountLabel: 'Stocks marchandises',
          accountClass: 3,
          totalDebit: '12000.00',
          totalCredit: '0.00',
        },
        // Créance client 411 → Actif circulant
        {
          accountCode: '411000',
          accountLabel: 'CLIENT X',
          accountClass: 4,
          totalDebit: '8000.00',
          totalCredit: '3000.00',
        },
        // Dette fournisseur 401 → Passif circulant
        {
          accountCode: '401000',
          accountLabel: 'FOURNISSEUR Y',
          accountClass: 4,
          totalDebit: '2000.00',
          totalCredit: '7000.00',
        },
        // Banque (cl. 5) débit → Trésorerie actif
        {
          accountCode: '512000',
          accountLabel: 'Banque',
          accountClass: 5,
          totalDebit: '10000.00',
          totalCredit: '4000.00',
        },
        // Capital (cl. 1, code 101) → Capitaux propres
        {
          accountCode: '101000',
          accountLabel: 'Capital social',
          accountClass: 1,
          totalDebit: '0.00',
          totalCredit: '60000.00',
        },
        // Emprunt bancaire (cl. 1, code 161) → Dettes financières
        {
          accountCode: '161000',
          accountLabel: 'Emprunt bancaire',
          accountClass: 1,
          totalDebit: '0.00',
          totalCredit: '6000.00',
        },
      ]),
    );

    const result = await h.service.getBalanceSheet(ORG_ID, { asAtDate: '2026-12-31' });

    const actifSect = Object.fromEntries(result.actif.sections.map((s) => [s.key, s]));
    expect(actifSect['IMMOBILISE'].total).toBe('50000.00');
    expect(actifSect['CIRCULANT'].total).toBe('17000.00'); // 12000 + (8000-3000)
    expect(actifSect['TRESORERIE_ACTIF'].total).toBe('6000.00'); // 10000-4000
    expect(result.actif.total).toBe('73000.00');

    const passifSect = Object.fromEntries(result.passif.sections.map((s) => [s.key, s]));
    expect(passifSect['CAPITAUX_PROPRES'].total).toBe('60000.00');
    expect(passifSect['DETTES_FINANCIERES'].total).toBe('6000.00');
    expect(passifSect['PASSIF_CIRCULANT'].total).toBe('5000.00'); // 7000-2000
    expect(result.passif.total).toBe('71000.00');

    // Difference = 73000 - 71000 = 2000 (résultat non incorporé en wave 2)
    expect(result.difference).toBe('2000.00');
  });

  it('rejects malformed asAtDate before hitting the DB', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest.fn();
    await expect(
      h.service.getBalanceSheet(ORG_ID, { asAtDate: 'not-a-date' }),
    ).rejects.toMatchObject({ code: 'REPORT_INVALID_DATE_RANGE' });
    expect(h.repo.accountBalancesAsAt).not.toHaveBeenCalled();
  });

  it('skips zero-balance accounts (no movement contribution)', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest.fn().mockResolvedValue(
      balancesAsAt([
        {
          accountCode: '211000',
          accountLabel: 'Fonds',
          accountClass: 2,
          totalDebit: '10000.00',
          totalCredit: '10000.00',
        },
        {
          accountCode: '512000',
          accountLabel: 'Banque',
          accountClass: 5,
          totalDebit: '5000.00',
          totalCredit: '0.00',
        },
      ]),
    );
    const result = await h.service.getBalanceSheet(ORG_ID, { asAtDate: '2026-12-31' });
    // The 211 net balance is 0 → excluded; only the 512 remains.
    expect(result.actif.total).toBe('5000.00');
    const immo = result.actif.sections.find((s) => s.key === 'IMMOBILISE');
    expect(immo?.groups).toHaveLength(0);
  });

  it('routes a 5xx with credit balance to TRESORERIE_PASSIF (découvert)', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest.fn().mockResolvedValue(
      balancesAsAt([
        {
          accountCode: '512000',
          accountLabel: 'Banque',
          accountClass: 5,
          totalDebit: '1000.00',
          totalCredit: '4000.00',
        },
      ]),
    );
    const result = await h.service.getBalanceSheet(ORG_ID, { asAtDate: '2026-12-31' });
    const tresoPassif = result.passif.sections.find((s) => s.key === 'TRESORERIE_PASSIF');
    expect(tresoPassif?.total).toBe('3000.00');
  });

  // ── W1.4 — comptes opposants (Tome 1 OHADA G02) ───────────────────
  it('soustrait une dépréciation 4912 créditrice du poste ACTIF circulant (et ne la pousse pas au passif)', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest.fn().mockResolvedValue(
      balancesAsAt([
        // Créance client de 200 000 (sens normal débiteur)
        {
          accountCode: '411000',
          accountLabel: 'CLIENT X',
          accountClass: 4,
          totalDebit: '200000.00',
          totalCredit: '0.00',
        },
        // Dépréciation client de 50 000 (sens normal CRÉDITEUR pour
        // un compte opposant — vient en DÉDUCTION du poste actif).
        {
          accountId: 'opp-4912',
          accountCode: '491200',
          accountLabel: 'Dépréciation client X',
          accountClass: 4,
          isOpposing: true,
          totalDebit: '0.00',
          totalCredit: '50000.00',
        },
      ]),
    );
    const result = await h.service.getBalanceSheet(ORG_ID, { asAtDate: '2026-12-31' });

    // Le 4912 N'apparaît PAS au passif (bug avant W1.4).
    const passifCirc = result.passif.sections.find((s) => s.key === 'PASSIF_CIRCULANT');
    expect(passifCirc?.groups ?? []).toHaveLength(0);
    expect(passifCirc?.total).toBe('0.00');

    // Il apparaît bien au poste actif circulant, listé, mais soustrait
    // au total : 200 000 − 50 000 = 150 000.
    const actifCirc = result.actif.sections.find((s) => s.key === 'CIRCULANT');
    const codes = (actifCirc?.groups ?? []).map((g) => g.code).sort();
    expect(codes).toEqual(['411000', '491200']);
    expect(actifCirc?.total).toBe('150000.00');
    expect(result.actif.total).toBe('150000.00');
  });
});

// ─── Module 9 wave 3 — comparative + auto-consolidation ─────────────

describe('ReportsService.getProfitLoss — comparative N vs N-1', () => {
  it('returns previousAmount + variation + variationPercent per section when compareWith is set', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockImplementation((_org: unknown, filters: { fromDate: string }) => {
      if (filters.fromDate === '2026-01-01') {
        return Promise.resolve([
          tbRow({
            accountCode: '601000',
            accountClass: 6,
            periodDebit: '15000.00',
          }),
          tbRow({
            accountCode: '701000',
            accountClass: 7,
            periodCredit: '25000.00',
          }),
        ]);
      }
      return Promise.resolve([
        tbRow({
          accountCode: '601000',
          accountClass: 6,
          periodDebit: '10000.00',
        }),
        tbRow({
          accountCode: '701000',
          accountClass: 7,
          periodCredit: '20000.00',
        }),
      ]);
    });

    const result = await h.service.getProfitLoss(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      compareWith: { fromDate: '2025-01-01', toDate: '2025-12-31' },
    });

    expect(h.repo.trialBalance).toHaveBeenCalledTimes(2);
    const section60 = result.charges.find((s) => s.code === '60');
    expect(section60?.amount).toBe('15000.00');
    expect(section60?.previousAmount).toBe('10000.00');
    expect(section60?.variation).toBe('5000.00');
    expect(section60?.variationPercent).toBe('50.00');

    expect(result.previous).toEqual({
      fromDate: '2025-01-01',
      toDate: '2025-12-31',
      totalCharges: '10000.00',
      totalProduits: '20000.00',
      resultat: '10000.00',
    });
  });

  it('variationPercent is null when previous = 0 (avoid division by zero)', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValueOnce([
      tbRow({ accountCode: '601000', accountClass: 6, periodDebit: '5000.00' }),
    ]);
    h.repo.trialBalance.mockResolvedValueOnce([]); // previous period empty

    const result = await h.service.getProfitLoss(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      compareWith: { fromDate: '2025-01-01', toDate: '2025-12-31' },
    });
    const section60 = result.charges.find((s) => s.code === '60');
    expect(section60?.previousAmount).toBe('0.00');
    expect(section60?.variation).toBe('5000.00');
    expect(section60?.variationPercent).toBeNull();
  });

  it('omits previous + variation fields when compareWith is not provided (backward compat)', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValue([
      tbRow({ accountCode: '601000', accountClass: 6, periodDebit: '5000.00' }),
    ]);
    const result = await h.service.getProfitLoss(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    expect(result.previous).toBeUndefined();
    expect(result.charges[0].previousAmount).toBeUndefined();
    // `lines` est toujours présent, mais sans `amountPrevious`.
    expect(result.lines.every((l) => l.amountPrevious === undefined)).toBe(true);
  });

  it('enrichit `lines` avec `amountPrevious` quand compareWith est fourni', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockImplementation((_org: unknown, filters: { fromDate: string }) => {
      if (filters.fromDate === '2026-01-01') {
        return Promise.resolve([
          tbRow({ accountCode: '701000', accountClass: 7, periodCredit: '200.00' }),
        ]);
      }
      return Promise.resolve([
        tbRow({ accountCode: '701000', accountClass: 7, periodCredit: '100.00' }),
      ]);
    });
    const result = await h.service.getProfitLoss(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      compareWith: { fromDate: '2025-01-01', toDate: '2025-12-31' },
    });
    const ta = result.lines.find((l) => l.ref === 'TA');
    expect(ta?.amountN).toBe('200.00');
    expect(ta?.amountPrevious).toBe('100.00');
  });
});

describe('ReportsService.getBalanceSheet — auto-consolidation + comparative', () => {
  it('incorporates the net result as a "Résultat de l\'exercice (bénéfice)" line in capitaux propres', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest.fn().mockResolvedValue([
      {
        accountId: 'a-1',
        accountCode: '101000',
        accountLabel: 'Capital',
        accountClass: 1,
        totalDebit: '0.00',
        totalCredit: '50000.00',
      },
      {
        accountId: 'a-2',
        accountCode: '512000',
        accountLabel: 'Banque',
        accountClass: 5,
        totalDebit: '52000.00',
        totalCredit: '0.00',
      },
    ]);
    // P&L returns a 2000 net profit for the fiscal year.
    h.repo.trialBalance.mockResolvedValue([
      tbRow({ accountCode: '601000', accountClass: 6, periodDebit: '8000.00' }),
      tbRow({ accountCode: '701000', accountClass: 7, periodCredit: '10000.00' }),
    ]);

    const result = await h.service.getBalanceSheet(ORG_ID, {
      asAtDate: '2026-12-31',
      fiscalYearStartDate: '2026-01-01',
    });

    expect(result.netResultIncorporated).toBe('2000.00');
    const cp = result.passif.sections.find((s) => s.key === 'CAPITAUX_PROPRES');
    const netLine = cp?.groups.find((g) => g.accountId === '__net_result__');
    expect(netLine).toMatchObject({
      code: '130',
      label: "Résultat de l'exercice (bénéfice)",
      amount: '2000.00',
    });
    // 50000 capital + 2000 résultat = 52000 capitaux propres ; banque 52000 actif
    expect(cp?.total).toBe('52000.00');
    expect(result.difference).toBe('0.00');
  });

  it('incorporates a loss as code "129" and signs it negative in the section total', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest.fn().mockResolvedValue([
      {
        accountId: 'a-1',
        accountCode: '101000',
        accountLabel: 'Capital',
        accountClass: 1,
        totalDebit: '0.00',
        totalCredit: '50000.00',
      },
      {
        accountId: 'a-2',
        accountCode: '512000',
        accountLabel: 'Banque',
        accountClass: 5,
        totalDebit: '47000.00',
        totalCredit: '0.00',
      },
    ]);
    // P&L loss = -3000
    h.repo.trialBalance.mockResolvedValue([
      tbRow({ accountCode: '601000', accountClass: 6, periodDebit: '8000.00' }),
      tbRow({ accountCode: '701000', accountClass: 7, periodCredit: '5000.00' }),
    ]);

    const result = await h.service.getBalanceSheet(ORG_ID, {
      asAtDate: '2026-12-31',
      fiscalYearStartDate: '2026-01-01',
    });

    expect(result.netResultIncorporated).toBe('-3000.00');
    const cp = result.passif.sections.find((s) => s.key === 'CAPITAUX_PROPRES');
    const lossLine = cp?.groups.find((g) => g.accountId === '__net_result__');
    expect(lossLine?.code).toBe('129');
    expect(lossLine?.label).toBe("Résultat de l'exercice (perte)");
    // 50000 - 3000 = 47000 capitaux propres ; banque = 47000 actif → balanced
    expect(cp?.total).toBe('47000.00');
    expect(result.difference).toBe('0.00');
  });

  it('returns netResultIncorporated=null when fiscalYearStartDate is omitted (wave 2 behaviour)', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest.fn().mockResolvedValue([]);
    const result = await h.service.getBalanceSheet(ORG_ID, { asAtDate: '2026-12-31' });
    expect(result.netResultIncorporated).toBeNull();
  });

  it('includes a previous snapshot when compareWith is provided', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest
      .fn()
      .mockResolvedValueOnce([
        {
          accountId: 'a-1',
          accountCode: '512000',
          accountLabel: 'Banque',
          accountClass: 5,
          totalDebit: '8000.00',
          totalCredit: '0.00',
        },
      ])
      .mockResolvedValueOnce([
        {
          accountId: 'a-1',
          accountCode: '512000',
          accountLabel: 'Banque',
          accountClass: 5,
          totalDebit: '5000.00',
          totalCredit: '0.00',
        },
      ]);

    const result = await h.service.getBalanceSheet(ORG_ID, {
      asAtDate: '2026-12-31',
      compareWith: { asAtDate: '2025-12-31' },
    });

    expect(result.previous?.asAtDate).toBe('2025-12-31');
    expect(result.previous?.totalActif).toBe('5000.00');
    // Variation on the bank line: 8000 - 5000 = 3000
    const treso = result.actif.sections.find((s) => s.key === 'TRESORERIE_ACTIF');
    expect(treso?.previousTotal).toBe('5000.00');
    expect(treso?.groups[0]).toMatchObject({
      previousAmount: '5000.00',
      variation: '3000.00',
      variationPercent: '60.00',
    });
  });
});

describe('ReportsService.getComparativeBalance', () => {
  it('merges N and N-1 trial balances by accountId with mouvement + solde columns', async () => {
    const h = buildHarness();
    // First call → N (2026)
    h.repo.trialBalance.mockResolvedValueOnce([
      tbRow({
        accountId: 'a-1',
        accountCode: '411000',
        periodDebit: '2000.00',
        periodCredit: '500.00',
        endingDebit: '6000.00', // cumul à toDate
        endingCredit: '0.00',
      }),
    ]);
    // Second call → N-1 (2025)
    h.repo.trialBalance.mockResolvedValueOnce([
      tbRow({
        accountId: 'a-1',
        accountCode: '411000',
        periodDebit: '1200.00',
        periodCredit: '300.00',
        endingDebit: '4500.00',
        endingCredit: '0.00',
      }),
    ]);

    const result = await h.service.getComparativeBalance(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      previousFromDate: '2025-01-01',
      previousToDate: '2025-12-31',
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      accountId: 'a-1',
      accountCode: '411000',
      accountLabel: 'CLIENT X',
      accountClass: 4,
      previousPeriodDebit: '1200.00',
      previousPeriodCredit: '300.00',
      periodDebit: '2000.00',
      periodCredit: '500.00',
      endingDebit: '6000.00',
      endingCredit: '0.00',
      // netVariation = (2000-500) - (1200-300) = 1500 - 900 = 600
      netVariation: '600.00',
      // 600 / |900| * 100 = 66.67
      netVariationPercent: '66.67',
    });
    expect(result.totals.periodDebit).toBe('2000.00');
    expect(result.totals.previousPeriodDebit).toBe('1200.00');
    expect(result.totals.endingDebit).toBe('6000.00');
  });

  it('zero-fills accounts that exist in N-1 only', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValueOnce([]); // N empty
    h.repo.trialBalance.mockResolvedValueOnce([
      tbRow({
        accountId: 'a-2',
        accountCode: '601000',
        periodDebit: '800.00',
        endingDebit: '800.00',
      }),
    ]);

    const result = await h.service.getComparativeBalance(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      previousFromDate: '2025-01-01',
      previousToDate: '2025-12-31',
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      accountCode: '601000',
      previousPeriodDebit: '800.00',
      periodDebit: '0.00',
      periodCredit: '0.00',
      // SOLDE fallback = N-1 ending (account not seen in N)
      endingDebit: '800.00',
      netVariation: '-800.00',
    });
  });

  it('zero-fills accounts that exist in N only', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValueOnce([
      tbRow({
        accountId: 'a-3',
        accountCode: '707000',
        periodCredit: '5000.00',
        endingCredit: '5000.00',
      }),
    ]);
    h.repo.trialBalance.mockResolvedValueOnce([]); // N-1 empty

    const result = await h.service.getComparativeBalance(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      previousFromDate: '2025-01-01',
      previousToDate: '2025-12-31',
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      accountCode: '707000',
      previousPeriodDebit: '0.00',
      previousPeriodCredit: '0.00',
      periodCredit: '5000.00',
      endingCredit: '5000.00',
      netVariationPercent: null, // base N-1 nulle
    });
  });

  it('sorts rows by accountCode ASC', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValueOnce([
      tbRow({ accountId: 'a-7', accountCode: '707000', periodCredit: '100.00' }),
      tbRow({ accountId: 'a-4', accountCode: '411000', periodDebit: '100.00' }),
    ]);
    h.repo.trialBalance.mockResolvedValueOnce([]);

    const result = await h.service.getComparativeBalance(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      previousFromDate: '2025-01-01',
      previousToDate: '2025-12-31',
    });

    expect(result.rows.map((r) => r.accountCode)).toEqual(['411000', '707000']);
  });

  it('hideEmpty drops accounts with zero everywhere', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValueOnce([
      tbRow({ accountId: 'a-1', accountCode: '411000', periodDebit: '500.00' }),
      tbRow({ accountId: 'a-2', accountCode: '512000' }), // all zeros, both calls
    ]);
    h.repo.trialBalance.mockResolvedValueOnce([tbRow({ accountId: 'a-2', accountCode: '512000' })]);

    const result = await h.service.getComparativeBalance(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      previousFromDate: '2025-01-01',
      previousToDate: '2025-12-31',
      hideEmpty: true,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].accountCode).toBe('411000');
  });

  it('rejects with REPORT_INVALID_DATE_RANGE when previous range is inverted', async () => {
    const h = buildHarness();
    await expect(
      h.service.getComparativeBalance(ORG_ID, {
        fromDate: '2026-01-01',
        toDate: '2026-12-31',
        previousFromDate: '2025-12-31',
        previousToDate: '2025-01-01',
      }),
    ).rejects.toMatchObject({ code: 'REPORT_INVALID_DATE_RANGE' });
    expect(h.repo.trialBalance).not.toHaveBeenCalled();
  });
});

describe('ReportsService.getSig (Soldes Intermédiaires de Gestion)', () => {
  it('computes the full cascade XA → XI on a basic trading scenario', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValue([
      // Ventes marchandises (TA) = 110M crédit net
      tbRow({
        accountId: 'a-ta',
        accountCode: '701000',
        accountClass: 7,
        periodCredit: '110000000.00',
      }),
      // Achats marchandises (RA) = 75M débit net
      tbRow({
        accountId: 'a-ra',
        accountCode: '601000',
        accountClass: 6,
        periodDebit: '75000000.00',
      }),
      // Variation stocks marchandises (RB) = 5M débit
      tbRow({
        accountId: 'a-rb',
        accountCode: '603100',
        accountClass: 6,
        periodDebit: '5000000.00',
      }),
      // Charges de personnel (RK) = 20M
      tbRow({
        accountId: 'a-rk',
        accountCode: '661000',
        accountClass: 6,
        periodDebit: '20000000.00',
      }),
      // Impôt sur résultat (RS) = 3M
      tbRow({
        accountId: 'a-rs',
        accountCode: '891000',
        accountClass: 8,
        periodDebit: '3000000.00',
      }),
    ]);

    const report = await h.service.getSig(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });

    const soldeByCode = (code: string): string =>
      report.soldes.find((s) => s.code === code)?.amount ?? 'missing';

    // XA Marge commerciale = TA - RA - RB = 110M - 75M - 5M = 30M
    expect(soldeByCode('XA')).toBe('30000000.00');
    // XB CA = TA + TB + TC + TD = 110M (TB/TC/TD nuls)
    expect(soldeByCode('XB')).toBe('110000000.00');
    // XC VA = XB - RA - RB + 0 - 0 = 110M - 80M = 30M
    expect(soldeByCode('XC')).toBe('30000000.00');
    // XD EBE = XC - RK = 30M - 20M = 10M
    expect(soldeByCode('XD')).toBe('10000000.00');
    // XE Résultat exploit = XD + 0 (TJ) - 0 (RL) = 10M
    expect(soldeByCode('XE')).toBe('10000000.00');
    // XF Résultat financier = 0
    expect(soldeByCode('XF')).toBe('0.00');
    // XG RAO = XE + XF = 10M
    expect(soldeByCode('XG')).toBe('10000000.00');
    // XH RHAO = 0
    expect(soldeByCode('XH')).toBe('0.00');
    // XI Résultat net = XG + XH - RQ - RS = 10M - 3M = 7M
    expect(soldeByCode('XI')).toBe('7000000.00');
  });

  it('conserve le signe d’une variation de stock favorable (stockage) — RB créditeur augmente la marge', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValue([
      tbRow({
        accountId: 'a-ta',
        accountCode: '701000',
        accountClass: 7,
        periodCredit: '110000000.00',
      }),
      tbRow({
        accountId: 'a-ra',
        accountCode: '601000',
        accountClass: 6,
        periodDebit: '75000000.00',
      }),
      // Stockage : 6031 créditeur 5M (le stock augmente → réduit le coût des ventes).
      tbRow({
        accountId: 'a-rb',
        accountCode: '603100',
        accountClass: 6,
        periodCredit: '5000000.00',
      }),
    ]);
    const report = await h.service.getSig(ORG_ID, { fromDate: '2026-01-01', toDate: '2026-12-31' });
    const soldeByCode = (code: string): string =>
      report.soldes.find((s) => s.code === code)?.amount ?? 'missing';
    // RB net = D-C = -5M, CONSERVÉ (pas écrêté à 0). XA = TA - RA - RB = 110 - 75 - (-5) = 40M.
    // (Avant le fix, RB était écrêté à 0 → XA = 35M, marge sous-évaluée.)
    expect(soldeByCode('XA')).toBe('40000000.00');
    expect(soldeByCode('XC')).toBe('40000000.00');
  });

  it('classe 687 (dotations HAO) et 697 (dotations financières) hors du résultat d’exploitation', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValue([
      tbRow({
        accountId: 'a-ta',
        accountCode: '701000',
        accountClass: 7,
        periodCredit: '100000000.00',
      }),
      tbRow({
        accountId: 'a-ra',
        accountCode: '601000',
        accountClass: 6,
        periodDebit: '60000000.00',
      }),
      tbRow({
        accountId: 'a-rl',
        accountCode: '681000',
        accountClass: 6,
        periodDebit: '10000000.00',
      }), // dotation expl → RL
      tbRow({
        accountId: 'a-hao',
        accountCode: '687000',
        accountClass: 6,
        periodDebit: '4000000.00',
      }), // dotation HAO → RP
      tbRow({
        accountId: 'a-fin',
        accountCode: '697000',
        accountClass: 6,
        periodDebit: '3000000.00',
      }), // dotation fin. → RM
    ]);
    const report = await h.service.getSig(ORG_ID, { fromDate: '2026-01-01', toDate: '2026-12-31' });
    const s = (code: string): string =>
      report.soldes.find((x) => x.code === code)?.amount ?? 'missing';
    // RL = 681 seul (10M). XE = XD - RL = 40M - 10M = 30M (687/697 NE minorent PAS l'exploitation).
    expect(s('XE')).toBe('30000000.00');
    // 697 → RM (financier) : XF = -3M.
    expect(s('XF')).toBe('-3000000.00');
    // 687 → RP (HAO) : XH = -4M.
    expect(s('XH')).toBe('-4000000.00');
  });

  it('maps 6031 to RB (variation stocks marchandises) not RA via longest-prefix match', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValue([
      tbRow({
        accountId: 'a-1',
        accountCode: '603100',
        accountClass: 6,
        periodDebit: '1500.00',
      }),
    ]);
    const report = await h.service.getSig(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    const rb = report.charges.find((c) => c.code === 'RB');
    const ra = report.charges.find((c) => c.code === 'RA');
    expect(rb?.amount).toBe('1500.00');
    expect(ra?.amount).toBe('0.00');
  });

  it('returns all postes with zero amount when no movement', async () => {
    const h = buildHarness();
    h.repo.trialBalance.mockResolvedValue([]);
    const report = await h.service.getSig(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    // 17 postes de charges + 15 postes de produits + 9 soldes
    expect(report.charges).toHaveLength(17);
    expect(report.produits).toHaveLength(15);
    expect(report.soldes).toHaveLength(9);
    expect(report.soldes.every((s) => s.amount === '0.00')).toBe(true);
  });

  it('attaches previous-period amounts + variation when compareWith is set', async () => {
    const h = buildHarness();
    // Première résolution → période N
    h.repo.trialBalance.mockResolvedValueOnce([
      tbRow({
        accountId: 'a-1',
        accountCode: '701000',
        accountClass: 7,
        periodCredit: '200.00',
      }),
    ]);
    // Deuxième résolution → période N-1
    h.repo.trialBalance.mockResolvedValueOnce([
      tbRow({
        accountId: 'a-1',
        accountCode: '701000',
        accountClass: 7,
        periodCredit: '100.00',
      }),
    ]);

    const report = await h.service.getSig(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      compareWith: { fromDate: '2025-01-01', toDate: '2025-12-31' },
    });

    expect(report.previous).toEqual({ fromDate: '2025-01-01', toDate: '2025-12-31' });
    const xb = report.soldes.find((s) => s.code === 'XB');
    expect(xb?.amount).toBe('200.00');
    expect(xb?.previousAmount).toBe('100.00');
    expect(xb?.variation).toBe('100.00');
    expect(xb?.variationPercent).toBe('100.00');
  });

  it('rejects with REPORT_INVALID_DATE_RANGE on inverted comparison range', async () => {
    const h = buildHarness();
    await expect(
      h.service.getSig(ORG_ID, {
        fromDate: '2026-01-01',
        toDate: '2026-12-31',
        compareWith: { fromDate: '2025-12-31', toDate: '2025-01-01' },
      }),
    ).rejects.toMatchObject({ code: 'REPORT_INVALID_DATE_RANGE' });
  });
});

describe('ReportsService.getFinancialRatios', () => {
  function balanceRow(over: {
    accountId: string;
    accountCode: string;
    accountClass: number;
    totalDebit?: string;
    totalCredit?: string;
  }) {
    return {
      accountId: over.accountId,
      accountCode: over.accountCode,
      accountLabel: 'TEST',
      accountClass: over.accountClass,
      totalDebit: over.totalDebit ?? '0',
      totalCredit: over.totalCredit ?? '0',
    };
  }

  it('computes structure, liquidity, solvency and profitability ratios', async () => {
    const h = buildHarness();
    // Bilan as at date — fed by accountBalancesAsAt:
    // Actif : immo 600 (231) + circ 300 (411) + tréso 100 (521) = 1000
    // Passif : CP 400 (101) + DF 200 (162) + passif circ 350 (401) + tréso passif 50 (561) = 1000
    h.repo.accountBalancesAsAt.mockResolvedValue([
      balanceRow({
        accountId: 'a-immo',
        accountCode: '231000',
        accountClass: 2,
        totalDebit: '600',
      }),
      balanceRow({
        accountId: 'a-circ',
        accountCode: '411000',
        accountClass: 4,
        totalDebit: '300',
      }),
      balanceRow({
        accountId: 'a-tres',
        accountCode: '521000',
        accountClass: 5,
        totalDebit: '100',
      }),
      balanceRow({ accountId: 'a-cp', accountCode: '101000', accountClass: 1, totalCredit: '400' }),
      balanceRow({ accountId: 'a-df', accountCode: '162000', accountClass: 1, totalCredit: '200' }),
      balanceRow({ accountId: 'a-pc', accountCode: '401000', accountClass: 4, totalCredit: '350' }),
      balanceRow({ accountId: 'a-tp', accountCode: '561000', accountClass: 5, totalCredit: '50' }),
    ]);
    // SIG période — fed by trialBalance:
    // TB ventes 800, RC achats matières 600, RK perso 100, RL dotations 20
    h.repo.trialBalance.mockResolvedValue([
      tbRow({ accountId: 'a-ca', accountCode: '702000', accountClass: 7, periodCredit: '800' }),
      tbRow({ accountId: 'a-rc', accountCode: '602000', accountClass: 6, periodDebit: '600' }),
      tbRow({ accountId: 'a-rk', accountCode: '661000', accountClass: 6, periodDebit: '100' }),
      tbRow({ accountId: 'a-rl', accountCode: '681000', accountClass: 6, periodDebit: '20' }),
    ]);

    const report = await h.service.getFinancialRatios(ORG_ID, {
      asAtDate: '2026-12-31',
      fiscalYearStartDate: '2026-01-01',
    });

    const byCode = (c: string) => report.ratios.find((r) => r.code === c);
    // Autonomie financière = CP / Total passif. CP a été augmenté du
    // résultat net 80 par auto-incorporation (fiscalYearStartDate
    // fourni) → CP = 400 + 80 = 480. Total passif = 1000 + 80 = 1080.
    // AF = 480 / 1080 ≈ 44.44 %
    expect(byCode('AF')?.value).toBe('44.44');
    expect(byCode('AF')?.unit).toBe('PERCENT');
    expect(byCode('AF')?.interpretation).toContain('bon');
    // Endettement = DF / CP = 200 / 480 ≈ 0.4167
    expect(byCode('EF')?.value).toBe('0.4167');
    // Liquidité générale = (circulant + tréso) / passif CT = 400 / 400 = 1
    expect(byCode('LG')?.value).toBe('1.0000');
    // Liquidité immédiate = 100 / 400 = 0.25
    expect(byCode('LI')?.value).toBe('0.2500');
    // SIG : CA = 800, VA = 800-600 = 200, EBE = 200-100 = 100, RE = 100-20 = 80, RN = 80
    expect(byCode('RE')?.value).toBe('10.00'); // 80 / 800
    expect(byCode('RC')?.value).toBe('10.00');
  });

  it('returns value=null when denominator is zero', async () => {
    const h = buildHarness();
    // Bilan vide → tous les dénominateurs basés sur passif = 0
    h.repo.accountBalancesAsAt.mockResolvedValue([]);
    h.repo.trialBalance.mockResolvedValue([]);
    const report = await h.service.getFinancialRatios(ORG_ID, {
      asAtDate: '2026-12-31',
      fiscalYearStartDate: '2026-01-01',
    });
    const af = report.ratios.find((r) => r.code === 'AF');
    expect(af?.value).toBeNull();
  });

  it('rejects with REPORT_INVALID_DATE_RANGE when fiscalYearStartDate > asAtDate', async () => {
    const h = buildHarness();
    await expect(
      h.service.getFinancialRatios(ORG_ID, {
        asAtDate: '2026-01-01',
        fiscalYearStartDate: '2026-12-31',
      }),
    ).rejects.toMatchObject({ code: 'REPORT_INVALID_DATE_RANGE' });
  });
});

describe('ReportsService.getCashTrend', () => {
  function balanceRow(over: {
    accountId?: string;
    accountCode?: string;
    accountClass?: number;
    totalDebit?: string;
    totalCredit?: string;
  }) {
    return {
      accountId: over.accountId ?? 'a-x',
      accountCode: over.accountCode ?? '521000',
      accountLabel: 'BANQUE',
      accountClass: over.accountClass ?? 5,
      totalDebit: over.totalDebit ?? '0',
      totalCredit: over.totalCredit ?? '0',
    };
  }

  it('builds a monthly cash trend over a 3-month window', async () => {
    const h = buildHarness();
    // Jan : 100 débit. Feb : 150 débit cumulé. Mar : 130 débit cumulé.
    h.repo.accountBalancesAsAt
      .mockResolvedValueOnce([balanceRow({ totalDebit: '100' })])
      .mockResolvedValueOnce([balanceRow({ totalDebit: '150' })])
      .mockResolvedValueOnce([balanceRow({ totalDebit: '130' })]);

    const report = await h.service.getCashTrend(ORG_ID, {
      fromMonth: '2026-01',
      toMonth: '2026-03',
    });

    expect(report.points).toHaveLength(3);
    expect(report.points[0]).toMatchObject({
      yearMonth: '2026-01',
      asAtDate: '2026-01-31',
      netCash: '100.00',
      change: null,
    });
    expect(report.points[1]).toMatchObject({
      yearMonth: '2026-02',
      asAtDate: '2026-02-28',
      netCash: '150.00',
      change: '50.00',
    });
    expect(report.points[2]).toMatchObject({
      yearMonth: '2026-03',
      asAtDate: '2026-03-31',
      netCash: '130.00',
      change: '-20.00',
    });
    expect(report.currentNetCash).toBe('130.00');
    expect(report.minNetCash).toBe('100.00');
    expect(report.maxNetCash).toBe('150.00');
  });

  it('treats credit balance on class 5 account as overdraft (negative contribution)', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt.mockResolvedValueOnce([
      balanceRow({ totalDebit: '200', totalCredit: '50' }), // banque solde +150
      balanceRow({
        accountId: 'a-overdraft',
        accountCode: '521900',
        totalCredit: '300',
      }), // découvert -300
    ]);
    const report = await h.service.getCashTrend(ORG_ID, {
      fromMonth: '2026-01',
      toMonth: '2026-01',
    });
    // Net = +150 + (-300) = -150
    expect(report.points[0].netCash).toBe('-150.00');
  });

  it('excludes accounts not in class 5', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt.mockResolvedValueOnce([
      balanceRow({ totalDebit: '500' }), // class 5 ok
      balanceRow({
        accountId: 'a-cli',
        accountCode: '411000',
        accountClass: 4,
        totalDebit: '99999',
      }), // class 4 ignored
    ]);
    const report = await h.service.getCashTrend(ORG_ID, {
      fromMonth: '2026-01',
      toMonth: '2026-01',
    });
    expect(report.points[0].netCash).toBe('500.00');
  });

  it('rejects with REPORT_INVALID_DATE_RANGE on bad YYYY-MM format', async () => {
    const h = buildHarness();
    await expect(
      h.service.getCashTrend(ORG_ID, { fromMonth: '2026-1', toMonth: '2026-12' }),
    ).rejects.toMatchObject({ code: 'REPORT_INVALID_DATE_RANGE' });
  });

  it('rejects when fromMonth > toMonth', async () => {
    const h = buildHarness();
    await expect(
      h.service.getCashTrend(ORG_ID, { fromMonth: '2026-12', toMonth: '2026-01' }),
    ).rejects.toMatchObject({ code: 'REPORT_INVALID_DATE_RANGE' });
  });

  it('rejects when window exceeds 60 months', async () => {
    const h = buildHarness();
    await expect(
      h.service.getCashTrend(ORG_ID, { fromMonth: '2020-01', toMonth: '2026-12' }),
    ).rejects.toMatchObject({ code: 'REPORT_INVALID_DATE_RANGE' });
  });
});

describe('ReportsService static helpers', () => {
  it('enumerates months inclusively across a year boundary', () => {
    expect(ReportsService.enumerateMonths('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('lastDayOfMonth handles February of leap year', () => {
    expect(ReportsService.lastDayOfMonth('2024-02')).toBe('2024-02-29');
    expect(ReportsService.lastDayOfMonth('2025-02')).toBe('2025-02-28');
    expect(ReportsService.lastDayOfMonth('2026-12')).toBe('2026-12-31');
  });

  it('isYearMonth rejects malformed inputs', () => {
    expect(ReportsService.isYearMonth('2026-01')).toBe(true);
    expect(ReportsService.isYearMonth('2026-13')).toBe(false);
    expect(ReportsService.isYearMonth('2026-1')).toBe(false);
    expect(ReportsService.isYearMonth('26-01')).toBe(false);
  });
});

describe('ReportsService.percentChange (static)', () => {
  it.each([
    [100, 150, '50.00'],
    [100, 50, '-50.00'],
    [200, 200, '0.00'],
    [-100, -50, '50.00'], // |previous| denominator
  ])('percentChange(%s, %s) → %s', (prev, cur, expected) => {
    expect(ReportsService.percentChange(prev, cur)).toBe(expected);
  });

  it('returns null when previous is zero (no meaningful %)', () => {
    expect(ReportsService.percentChange(0, 100)).toBeNull();
    expect(ReportsService.percentChange(0.001, 100)).toBeNull();
  });
});

describe('ReportsService.getMultiYearBalance', () => {
  it('merges N periods by accountId with one net per period + final solde', async () => {
    const h = buildHarness();
    h.repo.trialBalance
      .mockResolvedValueOnce([
        tbRow({
          accountId: 'a-1',
          accountCode: '411000',
          periodDebit: '100',
          periodCredit: '20',
          endingDebit: '80',
        }),
      ])
      .mockResolvedValueOnce([
        tbRow({
          accountId: 'a-1',
          accountCode: '411000',
          periodDebit: '200',
          periodCredit: '50',
          endingDebit: '230',
        }),
      ])
      .mockResolvedValueOnce([
        tbRow({
          accountId: 'a-1',
          accountCode: '411000',
          periodDebit: '300',
          periodCredit: '100',
          endingDebit: '430.00',
        }),
      ]);
    const report = await h.service.getMultiYearBalance(ORG_ID, {
      periods: [
        { fromDate: '2024-01-01', toDate: '2024-12-31' },
        { fromDate: '2025-01-01', toDate: '2025-12-31' },
        { fromDate: '2026-01-01', toDate: '2026-12-31' },
      ],
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].netByPeriod).toEqual(['80.00', '150.00', '200.00']);
    expect(report.rows[0].endingDebit).toBe('430.00');
  });

  it('rejects when fewer than 2 or more than 5 periods', async () => {
    const h = buildHarness();
    await expect(
      h.service.getMultiYearBalance(ORG_ID, {
        periods: [{ fromDate: '2026-01-01', toDate: '2026-12-31' }],
      }),
    ).rejects.toMatchObject({ code: 'REPORT_INVALID_DATE_RANGE' });
    await expect(
      h.service.getMultiYearBalance(ORG_ID, {
        periods: Array.from({ length: 6 }, (_, i) => ({
          fromDate: `${2020 + i}-01-01`,
          toDate: `${2020 + i}-12-31`,
        })),
      }),
    ).rejects.toMatchObject({ code: 'REPORT_INVALID_DATE_RANGE' });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// W2.1 — Bilan SYSCOHADA AUDCIF : hiérarchie 35 postes lettrés
// (masse → rubrique → poste). Tests sur le nouveau shape `actifMasses`
// / `passifMasses` / `totals` / `unclassified`.
// ═══════════════════════════════════════════════════════════════════════

describe('ReportsService.getBalanceSheet — W2.1 hiérarchie 35 postes lettrés', () => {
  function buildRow(o: {
    accountId?: string;
    accountCode: string;
    accountLabel?: string;
    accountClass: number;
    isOpposing?: boolean;
    totalDebit?: string;
    totalCredit?: string;
  }) {
    return {
      accountId: o.accountId ?? `acc-${o.accountCode}`,
      accountCode: o.accountCode,
      accountLabel: o.accountLabel ?? `Compte ${o.accountCode}`,
      accountClass: o.accountClass,
      isOpposing: o.isOpposing ?? false,
      totalDebit: o.totalDebit ?? '0.00',
      totalCredit: o.totalCredit ?? '0.00',
    };
  }

  it('classe un compte 411 (client) dans le poste BI, agrégé dans la masse BK via la sous-masse BG', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest
      .fn()
      .mockResolvedValue([
        buildRow({ accountCode: '411000', accountClass: 4, totalDebit: '8000' }),
      ]);
    const result = await h.service.getBalanceSheet(ORG_ID, { asAtDate: '2026-12-31' });

    // Le poste BI est rattaché à sa sous-masse directe BG (« Créances
    // et emplois assimilés »), elle-même incluse dans la masse BK.
    const allActifPostes = result.actifMasses.flatMap((m) => m.rubriques.flatMap((r) => r.postes));
    const bi = allActifPostes.find((p) => p.code === 'BI');
    expect(bi).toMatchObject({ code: 'BI', net: '8000.00' });

    // Les deux masses (BG sous-total, BK total) propagent la valeur.
    const bg = result.actifMasses.find((m) => m.code === 'BG');
    const bk = result.actifMasses.find((m) => m.code === 'BK');
    expect(bg?.total).toBe('8000.00');
    expect(bk?.total).toBe('8000.00');
  });

  it('soustrait un compte 281x (amortissement) en déduction du poste AD via deductionPrefixes', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest.fn().mockResolvedValue([
      // Frais de développement brut 100 000 (préfixe 211 → poste AE)
      buildRow({ accountCode: '211000', accountClass: 2, totalDebit: '100000' }),
      // Amortissement frais de dev 30 000 (préfixe 2811 → AE deduction)
      buildRow({ accountCode: '281100', accountClass: 2, totalCredit: '30000' }),
    ]);
    const result = await h.service.getBalanceSheet(ORG_ID, { asAtDate: '2026-12-31' });

    const ad = result.actifMasses.find((m) => m.code === 'AZ');
    const postes = ad?.rubriques.flatMap((r) => r.postes) ?? [];
    const ae = postes.find((p) => p.code === 'AE');
    expect(ae?.net).toBe('70000.00');
    expect(ae?.brut).toBe('100000.00');
    expect(ae?.deduction).toBe('30000.00');
  });

  it('soustrait un compte 4912 (dépréciation client opposante) du poste actif au lieu de gonfler le passif', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest.fn().mockResolvedValue([
      buildRow({ accountCode: '411000', accountClass: 4, totalDebit: '200000' }),
      buildRow({
        accountCode: '491200',
        accountClass: 4,
        isOpposing: true,
        totalCredit: '50000',
      }),
    ]);
    const result = await h.service.getBalanceSheet(ORG_ID, { asAtDate: '2026-12-31' });

    // Le 4912 NE DOIT PAS apparaître dans le passif (DP doit être vide ou absent).
    const dp = result.passifMasses.find((m) => m.code === 'DP');
    const passifPostes = dp?.rubriques.flatMap((r) => r.postes) ?? [];
    // Aucun poste passif ne doit contenir la dépréciation.
    expect(passifPostes.every((p) => Number(p.net) >= 0 || p.code !== 'DJ')).toBe(true);

    // Actif : 200 000 − 50 000 = 150 000 net.
    const bk = result.actifMasses.find((m) => m.code === 'BK');
    expect(bk?.total).toBe('150000.00');
  });

  it('classe un compte hors plan dans `unclassified` sans crasher', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest
      .fn()
      .mockResolvedValue([
        buildRow({ accountCode: '999999', accountClass: 2, totalDebit: '1234' }),
      ]);
    const result = await h.service.getBalanceSheet(ORG_ID, { asAtDate: '2026-12-31' });
    expect(result.unclassified.length).toBeGreaterThanOrEqual(1);
    expect(result.unclassified[0].code).toBe('999999');
  });

  it('smoke : bilan minimal 5 comptes — calcule les masses AZ, BK, BT, BZ et CP, DD, DF, DP, DZ', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest.fn().mockResolvedValue([
      buildRow({ accountCode: '231000', accountClass: 2, totalDebit: '60000' }), // AK (bâtiment) → AI → AZ
      buildRow({ accountCode: '411000', accountClass: 4, totalDebit: '20000' }), // BI → BG → BK
      buildRow({ accountCode: '512000', accountClass: 5, totalDebit: '10000' }), // BS → BT
      buildRow({ accountCode: '101000', accountClass: 1, totalCredit: '70000' }), // CA → CP → DF
      buildRow({ accountCode: '161000', accountClass: 1, totalCredit: '20000' }), // DA → DD → DF
    ]);
    const result = await h.service.getBalanceSheet(ORG_ID, { asAtDate: '2026-12-31' });

    const masseTotal = (side: 'actif' | 'passif', code: string): string =>
      (side === 'actif' ? result.actifMasses : result.passifMasses).find((m) => m.code === code)
        ?.total ?? '0.00';

    expect(masseTotal('actif', 'AZ')).toBe('60000.00');
    expect(masseTotal('actif', 'BK')).toBe('20000.00');
    expect(masseTotal('actif', 'BT')).toBe('10000.00');
    expect(masseTotal('actif', 'BZ')).toBe('90000.00');
    expect(masseTotal('passif', 'CP')).toBe('70000.00');
    expect(masseTotal('passif', 'DD')).toBe('20000.00');
    expect(masseTotal('passif', 'DF')).toBe('90000.00');
    expect(masseTotal('passif', 'DZ')).toBe('90000.00');
  });

  it('totals.difference ≈ 0 sur un bilan équilibré', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest
      .fn()
      .mockResolvedValue([
        buildRow({ accountCode: '231000', accountClass: 2, totalDebit: '50000' }),
        buildRow({ accountCode: '512000', accountClass: 5, totalDebit: '20000' }),
        buildRow({ accountCode: '101000', accountClass: 1, totalCredit: '70000' }),
      ]);
    const result = await h.service.getBalanceSheet(ORG_ID, { asAtDate: '2026-12-31' });
    expect(result.totals.actif).toBe('70000.00');
    expect(result.totals.passif).toBe('70000.00');
    expect(result.totals.difference).toBe('0.00');
  });

  it('expose totals.actif et totals.passif identiques à `actif.total` / `passif.total` (cohérence legacy)', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest
      .fn()
      .mockResolvedValue([
        buildRow({ accountCode: '411000', accountClass: 4, totalDebit: '5000' }),
        buildRow({ accountCode: '401000', accountClass: 4, totalCredit: '3000' }),
      ]);
    const result = await h.service.getBalanceSheet(ORG_ID, { asAtDate: '2026-12-31' });
    expect(result.totals.actif).toBe(result.actif.total);
    expect(result.totals.passif).toBe(result.passif.total);
  });

  it('classe un découvert bancaire (52/53 créditeur) au passif (DR) et garde le bilan équilibré', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest.fn().mockResolvedValue([
      buildRow({ accountCode: '231000', accountClass: 2, totalDebit: '100000' }),
      buildRow({ accountCode: '521000', accountClass: 5, totalCredit: '30000' }), // banque créditrice = découvert
      buildRow({ accountCode: '101000', accountClass: 1, totalCredit: '70000' }),
    ]);
    const result = await h.service.getBalanceSheet(ORG_ID, { asAtDate: '2026-12-31' });
    // Le découvert doit aller au PASSIF (DR), pas gonfler l'actif → bilan W2.1 équilibré.
    expect(result.totals.actif).toBe('100000.00');
    expect(result.totals.passif).toBe('100000.00');
    const dr = result.passifMasses
      .flatMap((m) => m.rubriques)
      .flatMap((r) => r.postes)
      .find((p) => p.code === 'DR');
    expect(dr?.net).toBe('30000.00');
  });

  it('classe une avance client (419 créditeur sans sous-compte) au passif (DI)', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest.fn().mockResolvedValue([
      buildRow({ accountCode: '521000', accountClass: 5, totalDebit: '50000' }),
      buildRow({ accountCode: '419000', accountClass: 4, totalCredit: '20000' }), // client créditeur = avance reçue
      buildRow({ accountCode: '101000', accountClass: 1, totalCredit: '30000' }),
    ]);
    const result = await h.service.getBalanceSheet(ORG_ID, { asAtDate: '2026-12-31' });
    expect(result.totals.actif).toBe('50000.00');
    expect(result.totals.passif).toBe('50000.00'); // 30000 capital + 20000 avance
    const di = result.passifMasses
      .flatMap((m) => m.rubriques)
      .flatMap((r) => r.postes)
      .find((p) => p.code === 'DI');
    expect(di?.net).toBe('20000.00');
  });

  it('incorporation du résultat net : ajoute le bénéfice au poste CJ sous CP', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest
      .fn()
      .mockResolvedValue([
        buildRow({ accountCode: '101000', accountClass: 1, totalCredit: '50000' }),
        buildRow({ accountCode: '512000', accountClass: 5, totalDebit: '52000' }),
      ]);
    h.repo.trialBalance.mockResolvedValue([
      tbRow({ accountCode: '601000', accountClass: 6, periodDebit: '8000' }),
      tbRow({ accountCode: '701000', accountClass: 7, periodCredit: '10000' }),
    ]);
    const result = await h.service.getBalanceSheet(ORG_ID, {
      asAtDate: '2026-12-31',
      fiscalYearStartDate: '2026-01-01',
    });
    const cp = result.passifMasses.find((m) => m.code === 'CP');
    const postes = cp?.rubriques.flatMap((r) => r.postes) ?? [];
    const cj = postes.find((p) => p.code === 'CJ');
    expect(cj?.net).toBe('2000.00');
    expect(cp?.total).toBe('52000.00');
    expect(result.totals.difference).toBe('0.00');
  });

  it('enrichit les postes avec netPrevious et netChange quand compareWith est fourni', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest
      .fn()
      .mockResolvedValueOnce([
        buildRow({ accountCode: '521000', accountClass: 5, totalDebit: '8000' }),
      ])
      .mockResolvedValueOnce([
        buildRow({ accountCode: '521000', accountClass: 5, totalDebit: '5000' }),
      ]);
    const result = await h.service.getBalanceSheet(ORG_ID, {
      asAtDate: '2026-12-31',
      compareWith: { asAtDate: '2025-12-31' },
    });
    const bt = result.actifMasses.find((m) => m.code === 'BT');
    expect(bt?.totalPrevious).toBe('5000.00');
    const postes = bt?.rubriques.flatMap((r) => r.postes) ?? [];
    const bs = postes.find((p) => p.code === 'BS');
    expect(bs?.netPrevious).toBe('5000.00');
    expect(bs?.netChange).toBe('3000.00');
  });

  it('préserve la rétro-compat : `actif.sections` (legacy 4 buckets) reste exposé', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest
      .fn()
      .mockResolvedValue([
        buildRow({ accountCode: '231000', accountClass: 2, totalDebit: '60000' }),
      ]);
    const result = await h.service.getBalanceSheet(ORG_ID, { asAtDate: '2026-12-31' });
    expect(result.actif.sections).toBeDefined();
    expect(result.actif.sections.find((s) => s.key === 'IMMOBILISE')?.total).toBe('60000.00');
  });
});

// ─── D1 — Balance âgée Tome 3 Notes 7 & 17 ──────────────────────────
describe('ReportsService.getAgingBalance (Tome 3 buckets standardisés)', () => {
  type BalanceRow = {
    accountId: string;
    accountCode: string;
    accountLabel: string;
    accountClass: number;
    isOpposing: boolean;
    totalDebit: string;
    totalCredit: string;
  };

  function balanceRow(over: Partial<BalanceRow> = {}): BalanceRow {
    return {
      accountId: 'a-1',
      accountCode: '411000',
      accountLabel: 'CLIENT X',
      accountClass: 4,
      isOpposing: false,
      totalDebit: '0.00',
      totalCredit: '0.00',
      ...over,
    };
  }

  function ledger(over: Partial<GeneralLedgerRow> = {}): GeneralLedgerRow {
    return {
      lineId: 'l-1',
      entryId: 'e-1',
      entryDate: '2026-12-31',
      journalCode: 'VTE',
      entryNumber: 1,
      description: null,
      debit: '0.00',
      credit: '0.00',
      letteringCode: null,
      ...over,
    };
  }

  it('ventile 4 factures clients d ages varies dans les 4 buckets Tome 3', async () => {
    // Arrange — arrete 2026-12-31. 4 factures non lettrees :
    //   age 10j  → 0-30j   (2026-12-21, 1000)
    //   age 45j  → 31-60j  (2026-11-16,  500)
    //   age 75j  → 61-90j  (2026-10-17,  300)
    //   age 200j → >90j    (2026-06-14,  700)
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest
      .fn()
      .mockResolvedValue([balanceRow({ accountCode: '411000', totalDebit: '2500.00' })]);
    h.repo.generalLedger.mockResolvedValue([
      ledger({ lineId: 'l-4', entryDate: '2026-06-14', debit: '700.00' }),
      ledger({ lineId: 'l-3', entryDate: '2026-10-17', debit: '300.00' }),
      ledger({ lineId: 'l-2', entryDate: '2026-11-16', debit: '500.00' }),
      ledger({ lineId: 'l-1', entryDate: '2026-12-21', debit: '1000.00' }),
    ]);

    const report = await h.service.getAgingBalance(ORG_ID, {
      side: 'CLIENT',
      asAtDate: '2026-12-31',
    });

    expect(report.bucketBoundaries).toEqual([30, 60, 90]);
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0];
    expect(row.buckets).toHaveLength(4);
    expect(row.buckets.map((b) => b.label)).toEqual(['0-30j', '31-60j', '61-90j', '>90j']);
    expect(row.buckets[0].amount).toBe('1000.00');
    expect(row.buckets[1].amount).toBe('500.00');
    expect(row.buckets[2].amount).toBe('300.00');
    expect(row.buckets[3].amount).toBe('700.00');
    expect(row.total).toBe('2500.00');
  });

  it('vieillit les créances à partir de la date d’échéance (dueDate), pas de la comptabilisation', async () => {
    // Facture comptabilisée le 2026-06-14 (âge 200j à l'arrêté) MAIS échéance
    // le 2026-12-25 (âge 6j). Le vieillissement doit suivre l'échéance → 0-30j.
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest
      .fn()
      .mockResolvedValue([balanceRow({ accountCode: '411000', totalDebit: '700.00' })]);
    h.repo.generalLedger.mockResolvedValue([
      ledger({ lineId: 'l-1', entryDate: '2026-06-14', dueDate: '2026-12-25', debit: '700.00' }),
    ]);

    const report = await h.service.getAgingBalance(ORG_ID, {
      side: 'CLIENT',
      asAtDate: '2026-12-31',
    });

    const row = report.rows[0];
    expect(row.buckets[0].amount).toBe('700.00'); // 0-30j (selon échéance)
    expect(row.buckets[3].amount).toBe('0.00'); // PAS >90j (selon comptabilisation)
    expect(row.total).toBe('700.00');
  });

  it('agrege bucketTotals + grandTotal sur plusieurs comptes', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest
      .fn()
      .mockResolvedValue([
        balanceRow({ accountId: 'a-1', accountCode: '411001', totalDebit: '1000.00' }),
        balanceRow({ accountId: 'a-2', accountCode: '411002', totalDebit: '2000.00' }),
      ]);
    h.repo.generalLedger.mockImplementation(async (_o: unknown, f: { accountId: string }) => {
      if (f.accountId === 'a-1') {
        return [ledger({ entryDate: '2026-12-21', debit: '1000.00' })];
      }
      return [ledger({ entryDate: '2026-06-14', debit: '2000.00' })];
    });

    const report = await h.service.getAgingBalance(ORG_ID, {
      side: 'CLIENT',
      asAtDate: '2026-12-31',
    });

    expect(report.rows).toHaveLength(2);
    expect(report.bucketTotals).toEqual(['1000.00', '0.00', '0.00', '2000.00']);
    expect(report.grandTotal).toBe('3000.00');
    expect(report.advances).toEqual([]);
  });

  it('signale les avances (client créditeur) hors des buckets et du grandTotal', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest.fn().mockResolvedValue([
      // Créance normale (débiteur) → vieillie.
      balanceRow({ accountId: 'a-1', accountCode: '411001', totalDebit: '1000.00' }),
      // Client globalement créditeur (avance reçue) → signalé à part.
      balanceRow({ accountId: 'a-2', accountCode: '411002', totalCredit: '500.00' }),
    ]);
    h.repo.generalLedger.mockImplementation(async (_o: unknown, f: { accountId: string }) => {
      if (f.accountId === 'a-1') return [ledger({ entryDate: '2026-12-21', debit: '1000.00' })];
      return [ledger({ entryDate: '2026-12-21', credit: '500.00' })];
    });

    const report = await h.service.getAgingBalance(ORG_ID, {
      side: 'CLIENT',
      asAtDate: '2026-12-31',
    });

    // a-1 vieilli normalement ; a-2 exclu des rows et du grandTotal.
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].accountCode).toBe('411001');
    expect(report.grandTotal).toBe('1000.00');
    // a-2 signalé comme avance (valeur absolue du solde créditeur).
    expect(report.advances).toHaveLength(1);
    expect(report.advances[0].accountCode).toBe('411002');
    expect(report.advances[0].amount).toBe('500.00');
  });

  it('filtre par prefixes CLIENT elargi : 411/412/416/418', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest
      .fn()
      .mockResolvedValue([
        balanceRow({ accountId: 'a-1', accountCode: '411000', totalDebit: '100' }),
        balanceRow({ accountId: 'a-2', accountCode: '412000', totalDebit: '200' }),
        balanceRow({ accountId: 'a-3', accountCode: '416000', totalDebit: '300' }),
        balanceRow({ accountId: 'a-4', accountCode: '418000', totalDebit: '400' }),
        balanceRow({ accountId: 'a-5', accountCode: '401000', totalCredit: '999' }),
        balanceRow({ accountId: 'a-6', accountCode: '707000', totalCredit: '999' }),
      ]);
    h.repo.generalLedger.mockResolvedValue([ledger({ entryDate: '2026-12-21', debit: '100.00' })]);

    const report = await h.service.getAgingBalance(ORG_ID, {
      side: 'CLIENT',
      asAtDate: '2026-12-31',
    });

    expect(report.rows.map((r) => r.accountCode)).toEqual(['411000', '412000', '416000', '418000']);
  });

  it('cote FOURNISSEUR : filtre 401/402/403/408 et credits = dettes ouvertes', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest
      .fn()
      .mockResolvedValue([
        balanceRow({ accountId: 'a-1', accountCode: '401000', totalCredit: '5000.00' }),
        balanceRow({ accountId: 'a-2', accountCode: '411000', totalDebit: '999' }),
      ]);
    h.repo.generalLedger.mockResolvedValue([
      ledger({ entryDate: '2026-06-14', credit: '5000.00' }),
    ]);

    const report = await h.service.getAgingBalance(ORG_ID, {
      side: 'FOURNISSEUR',
      asAtDate: '2026-12-31',
    });

    expect(report.side).toBe('FOURNISSEUR');
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].accountCode).toBe('401000');
    expect(report.rows[0].buckets[3].amount).toBe('5000.00');
    expect(report.grandTotal).toBe('5000.00');
  });

  it('ignore bucketBoundaries (deprecated) — toujours [30,60,90]', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest
      .fn()
      .mockResolvedValue([balanceRow({ accountCode: '411000', totalDebit: '100' })]);
    h.repo.generalLedger.mockResolvedValue([ledger({ entryDate: '2026-12-21', debit: '100.00' })]);

    const report = await h.service.getAgingBalance(ORG_ID, {
      side: 'CLIENT',
      asAtDate: '2026-12-31',
      bucketBoundaries: [7, 14, 28, 56, 112],
    });

    expect(report.bucketBoundaries).toEqual([30, 60, 90]);
    expect(report.rows[0].buckets).toHaveLength(4);
    expect(report.rows[0].buckets.map((b) => b.label)).toEqual([
      '0-30j',
      '31-60j',
      '61-90j',
      '>90j',
    ]);
  });

  it('imputation FIFO : un reglement eteint la facture la plus ancienne', async () => {
    const h = buildHarness();
    h.repo.accountBalancesAsAt = jest
      .fn()
      .mockResolvedValue([balanceRow({ accountCode: '411000', totalDebit: '500' })]);
    h.repo.generalLedger.mockResolvedValue([
      ledger({ lineId: 'l-1', entryDate: '2026-06-14', debit: '700.00' }),
      ledger({ lineId: 'l-2', entryDate: '2026-12-21', debit: '1000.00' }),
      ledger({ lineId: 'l-3', entryDate: '2026-12-28', credit: '700.00' }),
    ]);

    const report = await h.service.getAgingBalance(ORG_ID, {
      side: 'CLIENT',
      asAtDate: '2026-12-31',
    });

    expect(report.rows[0].buckets[0].amount).toBe('1000.00');
    expect(report.rows[0].buckets[3].amount).toBe('0.00');
    expect(report.rows[0].total).toBe('1000.00');
  });

  it('rejette asAtDate malforme avec REPORT_INVALID_DATE_RANGE', async () => {
    const h = buildHarness();
    await expect(
      h.service.getAgingBalance(ORG_ID, {
        side: 'CLIENT',
        asAtDate: '2026-1-1',
      }),
    ).rejects.toMatchObject({ code: 'REPORT_INVALID_DATE_RANGE' });
  });
});

// ─── D3 — Marge par axe analytique (aligné Note 34) ─────────────────────

describe('ReportsService.getMarginByAxis (D3 — Note 34 par axe)', () => {
  interface MbaRawRow {
    axisCode: string;
    accountCode: string;
    accountClass: number;
    periodDebit: string;
    periodCredit: string;
  }

  function buildMbaHarness(rawRows: MbaRawRow[]) {
    const repo = {
      marginByAxis: jest.fn().mockResolvedValue(rawRows),
    };
    const accounts = {
      findById: jest.fn(),
    };
    const service = new ReportsService(
      repo as unknown as ReportsRepository,
      accounts as unknown as OrganizationAccountRepository,
    );
    return { service, repo };
  }

  // Helper : ligne brute repo (l'agrégation P&L par axe).
  function raw(
    axisCode: string,
    accountCode: string,
    accountClass: number,
    debit: string,
    credit: string,
  ): MbaRawRow {
    return { axisCode, accountCode, accountClass, periodDebit: debit, periodCredit: credit };
  }

  it('ventile CA, achats, marge brute et taux par axe sur 3 chantiers', async () => {
    const rawRows: MbaRawRow[] = [
      // Chantier A : CA 10 000, achats 6 000 → marge 4 000 (40 %)
      raw('A', '707100', 7, '0.00', '10000.00'),
      raw('A', '601000', 6, '6000.00', '0.00'),
      // Chantier B : CA 5 000, achats 4 500 → marge 500 (10 %)
      raw('B', '707100', 7, '0.00', '5000.00'),
      raw('B', '601000', 6, '4500.00', '0.00'),
      // Chantier C : CA 2 000, achats 0 → marge 2 000 (100 %)
      raw('C', '707100', 7, '0.00', '2000.00'),
    ];
    const h = buildMbaHarness(rawRows);

    const out = await h.service.getMarginByAxis(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      axisType: 'CHANTIER',
    });

    expect(out.currency).toBe('XOF');
    expect(out.rows).toHaveLength(3);

    const a = out.rows.find((r) => r.axisCode === 'A');
    expect(a?.chiffreAffaires).toBe('10000.00');
    expect(a?.achatsConsommes).toBe('6000.00');
    expect(a?.margeBrute).toBe('4000.00');
    expect(a?.margeBrutePercent).toBe('40.00');

    const b = out.rows.find((r) => r.axisCode === 'B');
    expect(b?.margeBrute).toBe('500.00');
    expect(b?.margeBrutePercent).toBe('10.00');

    const c = out.rows.find((r) => r.axisCode === 'C');
    expect(c?.margeBrutePercent).toBe('100.00');

    // Totaux : CA 17 000, achats 10 500, marge 6 500 → 38.24 %
    expect(out.totals.chiffreAffaires).toBe('17000.00');
    expect(out.totals.achatsConsommes).toBe('10500.00');
    expect(out.totals.margeBrute).toBe('6500.00');
    expect(out.totals.margeBrutePercent).toBe('38.24');
  });

  it('calcule valeur ajoutée et EBE conformes à Note 34 par axe', async () => {
    // Chantier X : CA 100 000, achats (60) 30 000, services ext (62) 10 000,
    //  impôts/taxes (63) 5 000, charges personnel (66) 25 000, autres (64) 2 000.
    //   Marge brute = 100 000 − 30 000                           = 70 000 (70 %)
    //   VA (SIG officiel) = CA − achats − services − impôts − autres
    //                     = 100 000 − 30 000 − 10 000 − 5 000 − 2 000 = 53 000 (53 %)
    //   EBE = VA − personnel = 53 000 − 25 000                    = 28 000 (28 %)
    const rawRows: MbaRawRow[] = [
      raw('X', '701000', 7, '0.00', '100000.00'),
      raw('X', '601000', 6, '30000.00', '0.00'),
      raw('X', '624000', 6, '10000.00', '0.00'), // services extérieurs
      raw('X', '631000', 6, '5000.00', '0.00'), // impôts taxes
      raw('X', '641000', 6, '2000.00', '0.00'), // autres charges expl
      raw('X', '661000', 6, '25000.00', '0.00'), // personnel
    ];
    const h = buildMbaHarness(rawRows);

    const out = await h.service.getMarginByAxis(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      axisType: 'CHANTIER',
    });

    const x = out.rows[0];
    expect(x.axisCode).toBe('X');
    expect(x.margeBrute).toBe('70000.00');
    expect(x.margeBrutePercent).toBe('70.00');
    expect(x.valeurAjoutee).toBe('53000.00');
    expect(x.tauxValeurAjoutee).toBe('53.00');
    expect(x.excedentBrutExploit).toBe('28000.00');
    expect(x.tauxEbe).toBe('28.00');
    expect(x.chargesPersonnel).toBe('25000.00');
    // Résultat net = CA − (achats + personnel + autres compat)
    //   autres = services ext + impôts + autres expl = 10 000 + 5 000 + 2 000 = 17 000
    //   RN = 100 000 − 30 000 − 25 000 − 17 000 = 28 000
    expect(x.resultatNet).toBe('28000.00');
  });

  it('retourne null pour les taux quand le CA est nul (évite division par zéro)', async () => {
    const rawRows: MbaRawRow[] = [raw('Z', '601000', 6, '1000.00', '0.00')];
    const h = buildMbaHarness(rawRows);

    const out = await h.service.getMarginByAxis(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      axisType: 'BU',
    });

    const z = out.rows[0];
    expect(z.chiffreAffaires).toBe('0.00');
    expect(z.margeBrute).toBe('-1000.00');
    expect(z.margeBrutePercent).toBeNull();
    expect(z.tauxValeurAjoutee).toBeNull();
    expect(z.tauxEbe).toBeNull();
  });

  it('rejette un axisType vide', async () => {
    const h = buildMbaHarness([]);
    await expect(
      h.service.getMarginByAxis(ORG_ID, {
        fromDate: '2026-01-01',
        toDate: '2026-12-31',
        axisType: '   ',
      }),
    ).rejects.toThrow();
  });
});

describe('ReportsService.getPeriodValidity', () => {
  const agg = (
    over: Partial<{
      committedEntries: number;
      totalDebit: string;
      totalCredit: string;
      lastMovementDate: string | null;
    }> = {},
  ) => ({
    committedEntries: 0,
    totalDebit: '0.00',
    totalCredit: '0.00',
    lastMovementDate: null,
    ...over,
  });

  it('passe la fenêtre au repo et reporte un journal équilibré (imbalance 0)', async () => {
    const h = buildHarness();
    h.repo.periodValidity.mockResolvedValue(
      agg({
        committedEntries: 42,
        totalDebit: '1000.00',
        totalCredit: '1000.00',
        lastMovementDate: '2026-03-15',
      }),
    );

    const result = await h.service.getPeriodValidity(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });

    expect(h.repo.periodValidity).toHaveBeenCalledWith(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    expect(result.committedEntries).toBe(42);
    expect(result.imbalance).toBe(0);
    expect(result.lastMovementDate).toBe('2026-03-15');
    expect(result.periodClosed).toBe(false);
    expect(typeof result.computedAt).toBe('string');
  });

  it('expose un écart Σdébit−Σcrédit arrondi quand le journal est corrompu', async () => {
    const h = buildHarness();
    h.repo.periodValidity.mockResolvedValue(
      agg({ committedEntries: 3, totalDebit: '1500.40', totalCredit: '1000.00' }),
    );

    const result = await h.service.getPeriodValidity(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });

    expect(result.imbalance).toBe(500);
  });

  it('considère équilibré un écart sous le FCFA (tolérance arrondis)', async () => {
    const h = buildHarness();
    h.repo.periodValidity.mockResolvedValue(
      agg({ committedEntries: 1, totalDebit: '1000.40', totalCredit: '1000.00' }),
    );

    const result = await h.service.getPeriodValidity(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });

    expect(result.imbalance).toBe(0);
  });

  it('renvoie lastMovementDate null sur une période sans écriture', async () => {
    const h = buildHarness();
    h.repo.periodValidity.mockResolvedValue(agg({ committedEntries: 0 }));

    const result = await h.service.getPeriodValidity(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });

    expect(result.committedEntries).toBe(0);
    expect(result.lastMovementDate).toBeNull();
  });

  it('rejette une plage de dates invalide avant d’interroger le repo', async () => {
    const h = buildHarness();
    await expect(
      h.service.getPeriodValidity(ORG_ID, { fromDate: '2026-12-31', toDate: '2026-01-01' }),
    ).rejects.toThrow();
    expect(h.repo.periodValidity).not.toHaveBeenCalled();
  });
});
