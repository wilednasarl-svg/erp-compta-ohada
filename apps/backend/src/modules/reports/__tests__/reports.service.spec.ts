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

    expect(result.opening).toEqual({ openingDebit: '500.00', openingCredit: '0.00' });
    expect(result.lines.map((l) => l.runningBalance)).toEqual(['700.00', '600.00', '650.00']);
    expect(result.totals).toEqual({
      periodDebit: '250.00',
      periodCredit: '100.00',
      endingDebit: '650.00',
      endingCredit: '0.00',
    });
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
});

describe('ReportsService.getBalanceSheet', () => {
  function balancesAsAt(
    overrides: Array<{
      accountId?: string;
      accountCode: string;
      accountLabel: string;
      accountClass: number;
      totalDebit: string;
      totalCredit: string;
    }>,
  ) {
    return overrides.map((o, i) => ({
      accountId: o.accountId ?? `acc-${i}`,
      accountCode: o.accountCode,
      accountLabel: o.accountLabel,
      accountClass: o.accountClass,
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
    h.repo.trialBalance.mockResolvedValueOnce([
      tbRow({ accountId: 'a-2', accountCode: '512000' }),
    ]);

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
      balanceRow({ accountId: 'a-immo', accountCode: '231000', accountClass: 2, totalDebit: '600' }),
      balanceRow({ accountId: 'a-circ', accountCode: '411000', accountClass: 4, totalDebit: '300' }),
      balanceRow({ accountId: 'a-tres', accountCode: '521000', accountClass: 5, totalDebit: '100' }),
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
