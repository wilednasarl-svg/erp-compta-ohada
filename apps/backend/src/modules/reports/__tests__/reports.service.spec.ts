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
