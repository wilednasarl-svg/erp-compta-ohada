import type { DataSource, EntityManager } from 'typeorm';

import { AppException } from '../../../../common/errors/app-exception';
import { asTenantId } from '../../../../common/persistence/tenant-scope';
import type { OrganizationAccountRepository } from '../../../accounting-plan/repositories/organization-account.repository';
import type { AuditContext } from '../../../audit/services/audit-trail.service';
import type { EntriesService } from '../../../journals/services/entries.service';
import type { BankAccountsRepository } from '../../repositories/bank-accounts.repository';
import type { BankStatementLinesRepository } from '../../repositories/bank-statement-lines.repository';
import { BankEntryGenerationService } from '../bank-entry-generation.service';

const ORG = asTenantId('33333333-3333-4333-8333-333333333333');
const CTX: AuditContext = { ipAddress: null, userAgent: null };
const PARAMS = { counterpartAccountCode: '631500', journalCode: 'BQ' };

interface Mocks {
  findLine: jest.Mock;
  findAccount: jest.Mock;
  findChartById: jest.Mock;
  findChartByCode: jest.Mock;
  createDraft: jest.Mock;
  validate: jest.Mock;
  matchSave: jest.Mock;
  lineUpdate: jest.Mock;
}

function makeService(overrides: Partial<Record<keyof Mocks, jest.Mock>> = {}): {
  service: BankEntryGenerationService;
  m: Mocks;
} {
  const m: Mocks = {
    findLine: jest.fn().mockResolvedValue({
      id: 'line-1',
      organizationId: ORG,
      bankAccountId: 'bank-1',
      amount: '-15000.00',
      operationDate: '2026-05-20',
      label: 'FRAIS TENUE DE COMPTE',
      bankReference: 'REF42',
      matchStatus: 'unmatched',
    }),
    findAccount: jest.fn().mockResolvedValue({ id: 'bank-1', chartAccountId: 'chart-bank' }),
    findChartById: jest.fn().mockResolvedValue({ id: 'chart-bank', code: '521100' }),
    findChartByCode: jest.fn().mockResolvedValue({ id: 'chart-cp', code: '631500' }),
    createDraft: jest.fn().mockResolvedValue({ id: 'entry-1' }),
    validate: jest.fn().mockResolvedValue({
      id: 'entry-1',
      entryNumber: 7,
      lines: [
        { id: 'jel-cp', accountId: 'chart-cp', debit: '15000.00', credit: '0.00' },
        { id: 'jel-bank', accountId: 'chart-bank', debit: '0.00', credit: '15000.00' },
      ],
    }),
    matchSave: jest.fn(async (x: { id?: string }) => ({ ...x, id: 'match-1' })),
    lineUpdate: jest.fn().mockResolvedValue({ affected: 1 }),
    ...overrides,
  };

  const linesRepo = {
    findById: m.findLine,
  } as unknown as BankStatementLinesRepository;
  const accountsRepo = { findById: m.findAccount } as unknown as BankAccountsRepository;
  const orgAccounts = {
    findById: m.findChartById,
    findByCode: m.findChartByCode,
  } as unknown as OrganizationAccountRepository;
  const entries = {
    createDraft: m.createDraft,
    validate: m.validate,
  } as unknown as EntriesService;

  const repoFor = () => ({
    create: (x: unknown) => x,
    save: m.matchSave,
    update: m.lineUpdate,
  });
  const dataSource = {
    transaction: jest.fn(async (cb: (mgr: EntityManager) => Promise<unknown>) =>
      cb({ getRepository: repoFor } as unknown as EntityManager),
    ),
  } as unknown as DataSource;

  return {
    service: new BankEntryGenerationService(dataSource, linesRepo, accountsRepo, orgAccounts, entries),
    m,
  };
}

describe('BankEntryGenerationService', () => {
  it('comptabilise des frais (sortie) en D contrepartie / C banque et rapproche', async () => {
    const { service, m } = makeService();

    const result = await service.generateEntryForLine(ORG, 'line-1', PARAMS, 'user-1', CTX);

    // Écriture créée avec les bonnes lignes orientées + source bank_reconciliation.
    const [, input] = m.createDraft.mock.calls[0];
    expect(input.sourceType).toBe('bank_reconciliation');
    expect(input.journalCode).toBe('BQ');
    expect(input.entryDate).toBe('2026-05-20');
    expect(input.lines).toEqual([
      { accountCode: '631500', debit: 15000, credit: 0 },
      { accountCode: '521100', debit: 0, credit: 15000 },
    ]);

    // Validée puis rapprochée sur la LIGNE BANQUE.
    expect(m.validate).toHaveBeenCalled();
    const savedMatch = m.matchSave.mock.calls[0][0];
    expect(savedMatch.journalEntryLineId).toBe('jel-bank');
    expect(savedMatch.bankStatementLineId).toBe('line-1');
    expect(savedMatch.matchMethod).toBe('manual');

    // Ligne de relevé passée à 'matched'.
    expect(m.lineUpdate).toHaveBeenCalledWith(
      { id: 'line-1', organizationId: ORG },
      { matchStatus: 'matched' },
    );

    expect(result).toMatchObject({
      entryId: 'entry-1',
      entryNumber: 7,
      bankJournalEntryLineId: 'jel-bank',
      matchId: 'match-1',
      direction: 'outflow',
      absAmount: 15000,
    });
  });

  it('rejette une ligne introuvable', async () => {
    const { service } = makeService({ findLine: jest.fn().mockResolvedValue(null) });
    await expect(
      service.generateEntryForLine(ORG, 'x', PARAMS, 'user-1', CTX),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('rejette une ligne déjà rapprochée', async () => {
    const { service } = makeService({
      findLine: jest.fn().mockResolvedValue({
        id: 'line-1',
        bankAccountId: 'bank-1',
        amount: '-15000.00',
        operationDate: '2026-05-20',
        label: 'X',
        bankReference: null,
        matchStatus: 'matched',
      }),
    });
    await expect(
      service.generateEntryForLine(ORG, 'line-1', PARAMS, 'user-1', CTX),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('rejette une contrepartie inexistante', async () => {
    const { service } = makeService({ findChartByCode: jest.fn().mockResolvedValue(null) });
    await expect(
      service.generateEntryForLine(ORG, 'line-1', PARAMS, 'user-1', CTX),
    ).rejects.toBeInstanceOf(AppException);
  });
});
