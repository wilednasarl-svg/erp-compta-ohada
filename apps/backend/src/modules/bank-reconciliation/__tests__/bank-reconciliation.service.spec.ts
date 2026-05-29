/**
 * Unit tests for `BankReconciliationService` (wave 2 — N:M + FX).
 *
 * Stratégie : tous les collaborateurs sont mockés (repos, DataSource,
 * AuditTrailService, ExchangeRatesService). On vérifie l'orchestration,
 * la validation de la somme, le branchement FX et la propagation du
 * `matchGroupId`.
 */
import { type DataSource } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AuditTrailService } from '../../audit/services/audit-trail.service';
import type { ExchangeRatesService } from '../../multi-currency/services/exchange-rates.service';
import type { BankAccountsRepository } from '../repositories/bank-accounts.repository';
import type { BankReconciliationMatchesRepository } from '../repositories/bank-reconciliation-matches.repository';
import type { BankStatementLinesRepository } from '../repositories/bank-statement-lines.repository';
import type { BankStatementsRepository } from '../repositories/bank-statements.repository';
import { BankReconciliationService } from '../services/bank-reconciliation.service';

interface FakeEntryLine {
  readonly id: string;
  readonly accountId: string;
  readonly debit: string;
  readonly credit: string;
  readonly entryStatus: string;
}

function buildService(overrides: {
  entryLines: ReadonlyArray<FakeEntryLine>;
  stLine: {
    readonly id: string;
    readonly bankAccountId: string;
    readonly bankStatementId: string;
    readonly amount: string;
    readonly operationDate: string;
    readonly matchStatus: 'matched' | 'unmatched' | 'ignored';
  };
  account: {
    readonly id: string;
    readonly chartAccountId: string;
    readonly currency: string;
  };
  fxRate?: { readonly rate: string };
  fxThrows?: boolean;
  match?: {
    readonly id: string;
    readonly bankStatementLineId: string;
    readonly journalEntryLineId: string;
    readonly matchGroupId: string | null;
  };
  groupMembers?: ReadonlyArray<{ id: string }>;
}) {
  const createManyCalls: Array<ReadonlyArray<Record<string, unknown>>> = [];
  const deleteManyCalls: Array<ReadonlyArray<string>> = [];
  const statusUpdates: Array<{ id: string; status: string }> = [];

  const matchesRepo = {
    createMany: jest.fn(async (rows: ReadonlyArray<Record<string, unknown>>) => {
      createManyCalls.push(rows);
      return rows.map((r, i) => ({ ...r, id: `m${i}` }));
    }),
    findById: jest.fn(async () => overrides.match ?? null),
    findByGroup: jest.fn(async () => overrides.groupMembers ?? []),
    delete: jest.fn(async () => undefined),
    deleteMany: jest.fn(async (ids: ReadonlyArray<string>) => {
      deleteManyCalls.push(ids);
    }),
    countByStatementLine: jest.fn(async () => 0),
  } as unknown as BankReconciliationMatchesRepository;

  const accountsRepo = {
    findById: jest.fn(async () => overrides.account),
    update: jest.fn(async () => undefined),
  } as unknown as BankAccountsRepository;

  const linesRepo = {
    findById: jest.fn(async () => overrides.stLine),
    updateStatus: jest.fn(async (id: string, _org: string, status: string) => {
      statusUpdates.push({ id, status });
    }),
    countMatchedByStatement: jest.fn(async () => 0),
  } as unknown as BankStatementLinesRepository;

  const statementsRepo = {
    findById: jest.fn(async () => ({
      id: overrides.stLine.bankStatementId,
      bankAccountId: overrides.account.id,
      importedLinesCount: 10,
    })),
    updateCounts: jest.fn(async () => undefined),
  } as unknown as BankStatementsRepository;

  const audit = {
    record: jest.fn(async () => undefined),
  } as unknown as AuditTrailService;

  const exchangeRates = {
    getRateAtDate: jest.fn(async () => {
      if (overrides.fxThrows) throw new Error('no rate');
      return overrides.fxRate ?? { rate: '1', appliedSource: 'manual', inverted: false };
    }),
  } as unknown as ExchangeRatesService;

  // Fake EntityManager that returns a query-builder yielding the
  // configured entry lines + their entry status.
  const fakeQB = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawAndEntities: jest.fn(async () => ({
      entities: overrides.entryLines.map((l) => ({
        id: l.id,
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
      })),
      raw: overrides.entryLines.map((l) => ({ e_status: l.entryStatus })),
    })),
  };
  const manager = {
    getRepository: jest.fn(() => ({
      createQueryBuilder: () => fakeQB,
    })),
  };

  const dataSource = {
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => cb(manager)),
    getRepository: jest.fn(),
  } as unknown as DataSource;

  const service = new BankReconciliationService(
    dataSource,
    accountsRepo,
    statementsRepo,
    linesRepo,
    matchesRepo,
    audit,
    exchangeRates,
  );

  return {
    service,
    matchesRepo,
    createManyCalls,
    deleteManyCalls,
    statusUpdates,
    exchangeRates,
  };
}

describe('BankReconciliationService.applyMatch — 1:N + FX', () => {
  const ORG = asTenantId('00000000-0000-4000-8000-000000000001');
  const ACCT = '00000000-0000-4000-8000-000000000010';
  const CHART = '00000000-0000-4000-8000-000000000011';
  const ST_LINE = '00000000-0000-4000-8000-000000000020';
  const STATEMENT = '00000000-0000-4000-8000-000000000021';

  const baseStLine = {
    id: ST_LINE,
    bankAccountId: ACCT,
    bankStatementId: STATEMENT,
    amount: '300.00',
    operationDate: '2026-03-15',
    matchStatus: 'unmatched' as const,
  };

  it('applies a valid 1:N match (sum equals bank amount)', async () => {
    const { service, createManyCalls } = buildService({
      entryLines: [
        { id: 'e1', accountId: CHART, debit: '100', credit: '0', entryStatus: 'validated' },
        { id: 'e2', accountId: CHART, debit: '200', credit: '0', entryStatus: 'validated' },
      ],
      stLine: baseStLine,
      account: { id: ACCT, chartAccountId: CHART, currency: 'XOF' },
    });

    const result = await service.applyMatch(
      ORG,
      ST_LINE,
      ['e1', 'e2'],
      'manual',
      null,
      'user-1',
      {} as never,
    );

    expect(createManyCalls).toHaveLength(1);
    expect(createManyCalls[0]).toHaveLength(2);
    expect(result.matchGroupId).not.toBeNull();
    expect(result.fxRateApplied).toBeNull();
  });

  it('rejects when sum mismatches bank amount beyond tolerance', async () => {
    const { service } = buildService({
      entryLines: [
        { id: 'e1', accountId: CHART, debit: '100', credit: '0', entryStatus: 'validated' },
        { id: 'e2', accountId: CHART, debit: '150', credit: '0', entryStatus: 'validated' },
      ],
      stLine: baseStLine, // 300 expected
      account: { id: ACCT, chartAccountId: CHART, currency: 'XOF' },
    });

    await expect(
      service.applyMatch(ORG, ST_LINE, ['e1', 'e2'], 'manual', null, 'user-1', {} as never),
    ).rejects.toMatchObject({
      code: ERROR_CODES.BANK_RECONCILIATION_AMOUNT_MISMATCH,
    });
  });

  it('applies FX rate when bank currency differs from XOF', async () => {
    const { service, exchangeRates, createManyCalls } = buildService({
      entryLines: [
        // 656.957 XOF for 1 EUR (parité fixe)
        { id: 'e1', accountId: CHART, debit: '65695.70', credit: '0', entryStatus: 'validated' },
      ],
      stLine: { ...baseStLine, amount: '100.00' }, // 100 EUR
      account: { id: ACCT, chartAccountId: CHART, currency: 'EUR' },
      fxRate: { rate: '656.957' },
    });

    const result = await service.applyMatch(
      ORG,
      ST_LINE,
      ['e1'],
      'manual',
      null,
      'user-1',
      {} as never,
      { amountTolerance: 1 },
    );

    expect(exchangeRates.getRateAtDate).toHaveBeenCalledWith(ORG, 'EUR', 'XOF', '2026-03-15');
    expect(result.fxRateApplied).toBe('656.957');
    expect(createManyCalls[0]).toHaveLength(1);
  });

  it('wraps missing FX rate into BANK_FX_RATE_NOT_FOUND', async () => {
    const { service } = buildService({
      entryLines: [
        { id: 'e1', accountId: CHART, debit: '100', credit: '0', entryStatus: 'validated' },
      ],
      stLine: { ...baseStLine, amount: '100.00' },
      account: { id: ACCT, chartAccountId: CHART, currency: 'USD' },
      fxThrows: true,
    });

    await expect(
      service.applyMatch(ORG, ST_LINE, ['e1'], 'manual', null, 'user-1', {} as never),
    ).rejects.toMatchObject({ code: ERROR_CODES.BANK_FX_RATE_NOT_FOUND });
  });

  it('rejects empty or duplicated entry line ids', async () => {
    const { service } = buildService({
      entryLines: [],
      stLine: baseStLine,
      account: { id: ACCT, chartAccountId: CHART, currency: 'XOF' },
    });

    await expect(
      service.applyMatch(ORG, ST_LINE, [], 'manual', null, 'user-1', {} as never),
    ).rejects.toBeInstanceOf(AppException);

    await expect(
      service.applyMatch(ORG, ST_LINE, ['e1', 'e1'], 'manual', null, 'user-1', {} as never),
    ).rejects.toMatchObject({
      code: ERROR_CODES.BANK_RECONCILIATION_DUPLICATE_ENTRY_LINES,
    });
  });

  it('unmatch deletes the entire group when matchGroupId is set', async () => {
    const GROUP = '00000000-0000-4000-8000-000000000099';
    const { service, deleteManyCalls } = buildService({
      entryLines: [],
      stLine: baseStLine,
      account: { id: ACCT, chartAccountId: CHART, currency: 'XOF' },
      match: {
        id: 'm0',
        bankStatementLineId: ST_LINE,
        journalEntryLineId: 'e1',
        matchGroupId: GROUP,
      },
      groupMembers: [{ id: 'm0' }, { id: 'm1' }, { id: 'm2' }],
    });

    await service.unmatch(ORG, 'm0', 'user-1', {} as never);
    expect(deleteManyCalls).toHaveLength(1);
    expect(deleteManyCalls[0]).toEqual(['m0', 'm1', 'm2']);
  });
});
