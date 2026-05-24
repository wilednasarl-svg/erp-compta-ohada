import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { OrganizationAccountEntity } from '../../accounting-plan/entities/organization-account.entity';
import type { AccountingPeriodEntity } from '../entities/accounting-period.entity';
import type { JournalEntryEntity } from '../entities/journal-entry.entity';
import type { JournalEntity } from '../entities/journal.entity';
import { EntriesService } from '../services/entries.service';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const JOURNAL_ID = '00000000-0000-4000-8000-000000000003';
const PERIOD_ID = '00000000-0000-4000-8000-000000000004';
const ENTRY_ID = '00000000-0000-4000-8000-000000000005';
const ACC_606 = '00000000-0000-4000-8000-000000000010';
const ACC_401 = '00000000-0000-4000-8000-000000000011';
const ACC_TITLE = '00000000-0000-4000-8000-000000000012';

const CTX = {
  userId: USER_ID,
  organizationId: ORG_ID,
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

function makeJournal(): JournalEntity {
  return {
    id: JOURNAL_ID,
    organizationId: ORG_ID,
    code: 'AC',
    label: 'Achats',
    kind: 'AC',
    nextEntryNumber: 1,
    isActive: true,
    defaultAccountId: null,
  } as JournalEntity;
}

function makePeriod(status: 'open' | 'closed' = 'open'): AccountingPeriodEntity {
  return {
    id: PERIOD_ID,
    organizationId: ORG_ID,
    parentId: null,
    kind: 'MONTHLY',
    label: 'Jan 2026',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    status,
    closedAt: null,
    closedBy: null,
    reopenedReason: null,
  } as AccountingPeriodEntity;
}

function makeAccount(
  id: string,
  code: string,
  accountType: 'POSTING' | 'TITLE' = 'POSTING',
): OrganizationAccountEntity {
  return {
    id,
    organizationId: ORG_ID,
    code,
    accountType,
    isActive: true,
  } as OrganizationAccountEntity;
}

function makeEntry(overrides: Partial<JournalEntryEntity> = {}): JournalEntryEntity {
  return {
    id: ENTRY_ID,
    organizationId: ORG_ID,
    journalId: JOURNAL_ID,
    periodId: PERIOD_ID,
    entryNumber: 1,
    entryDate: '2026-01-15',
    description: 'Test',
    reference: null,
    status: 'draft',
    cancelsId: null,
    sourceType: 'manual',
    sourceImportSessionId: null,
    createdById: USER_ID,
    validatedAt: null,
    validatedById: null,
    cancelledAt: null,
    cancelledById: null,
    cancelledReason: null,
    ...overrides,
  } as JournalEntryEntity;
}

function buildService(
  overrides: {
    journal?: JournalEntity | null;
    period?: AccountingPeriodEntity | null;
    accountByCode?: Map<string, OrganizationAccountEntity>;
    entry?: JournalEntryEntity | null;
    lines?: Array<{
      id: string;
      accountId: string;
      debit: string;
      credit: string;
      position: number;
      description: string | null;
      lineLetter: string | null;
    }>;
  } = {},
) {
  const journal = overrides.journal === undefined ? makeJournal() : overrides.journal;
  const period = overrides.period === undefined ? makePeriod() : overrides.period;
  const accountByCode =
    overrides.accountByCode ??
    new Map([
      ['606000', makeAccount(ACC_606, '606000')],
      ['401000', makeAccount(ACC_401, '401000')],
      ['10000', makeAccount(ACC_TITLE, '10000', 'TITLE')],
    ]);
  const entry = overrides.entry === undefined ? makeEntry() : overrides.entry;

  const periodsRepo = {
    findContainingDate: jest.fn().mockResolvedValue(period),
    findById: jest.fn().mockResolvedValue(period),
  };

  const journalRepo = {
    findByCode: jest.fn().mockResolvedValue(journal),
    findById: jest.fn().mockResolvedValue(journal),
    assignNextEntryNumber: jest.fn().mockResolvedValue(1),
  };

  const createdEntry = makeEntry();
  const entryRepo = {
    create: jest.fn().mockResolvedValue(createdEntry),
    findById: jest.fn().mockResolvedValue(entry),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    listForOrg: jest.fn().mockResolvedValue({ entries: [], total: 0 }),
  };

  const lineRepo = {
    createMany: jest.fn().mockResolvedValue([]),
    listByEntry: jest.fn().mockResolvedValue(overrides.lines ?? []),
  };

  const audit = { record: jest.fn().mockResolvedValue(null) };

  // Mock the DataSource — for transactional paths, run the callback inline.
  const accountRepoForManager = {
    findOne: jest.fn().mockImplementation(({ where }: { where: { code: string } }) => {
      return accountByCode.get(where.code) ?? null;
    }),
  };
  const manager = {
    getRepository: jest.fn().mockReturnValue(accountRepoForManager),
    delete: jest.fn().mockResolvedValue({}),
  };
  const dataSource = {
    transaction: jest
      .fn()
      .mockImplementation(async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager)),
    manager: { delete: jest.fn().mockResolvedValue({}) },
    getRepository: jest.fn().mockReturnValue(accountRepoForManager),
  };

  const service = new EntriesService(
    dataSource as never,
    periodsRepo as never,
    journalRepo as never,
    entryRepo as never,
    lineRepo as never,
    audit as never,
  );

  return { service, journalRepo, entryRepo, lineRepo, periodsRepo, audit, manager };
}

// ─── createDraft — invariants ───────────────────────────────────────────────

describe('EntriesService.createDraft — balance invariants', () => {
  it('creates a balanced 2-line draft entry', async () => {
    const { service, entryRepo, lineRepo, audit } = buildService();

    const result = await service.createDraft(
      asTenantId(ORG_ID),
      {
        journalCode: 'AC',
        entryDate: '2026-01-15',
        description: 'Facture fournisseur',
        lines: [
          { accountCode: '606000', debit: 100, credit: 0, description: 'Achat' },
          { accountCode: '401000', debit: 0, credit: 100, description: 'Fournisseur' },
        ],
      },
      USER_ID,
      CTX,
    );

    expect(entryRepo.create).toHaveBeenCalled();
    expect(lineRepo.createMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'journals', action: 'journals.entry_created' }),
    );
    expect(result.status).toBe('draft');
    expect(result.entryNumber).toBe(1);
  });

  it('rejects an empty lines array', async () => {
    const { service } = buildService();
    await expect(
      service.createDraft(
        asTenantId(ORG_ID),
        { journalCode: 'AC', entryDate: '2026-01-15', description: '', lines: [] },
        USER_ID,
        CTX,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.JOURNAL_ENTRY_EMPTY_LINES });
  });

  it('rejects an unbalanced entry (debit ≠ credit)', async () => {
    const { service } = buildService();
    await expect(
      service.createDraft(
        asTenantId(ORG_ID),
        {
          journalCode: 'AC',
          entryDate: '2026-01-15',
          description: 'Unbalanced',
          lines: [
            { accountCode: '606000', debit: 100, credit: 0 },
            { accountCode: '401000', debit: 0, credit: 90 },
          ],
        },
        USER_ID,
        CTX,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.JOURNAL_ENTRY_UNBALANCED });
  });

  it('rejects a line with both debit > 0 AND credit > 0', async () => {
    const { service } = buildService();
    await expect(
      service.createDraft(
        asTenantId(ORG_ID),
        {
          journalCode: 'AC',
          entryDate: '2026-01-15',
          description: 'Bad line',
          lines: [
            { accountCode: '606000', debit: 100, credit: 50 },
            { accountCode: '401000', debit: 0, credit: 50 },
          ],
        },
        USER_ID,
        CTX,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.JOURNAL_ENTRY_INVALID_LINE });
  });

  it('rejects when account is not POSTING (TITLE)', async () => {
    const { service } = buildService();
    await expect(
      service.createDraft(
        asTenantId(ORG_ID),
        {
          journalCode: 'AC',
          entryDate: '2026-01-15',
          description: 'Use TITLE',
          lines: [
            { accountCode: '10000', debit: 100, credit: 0 },
            { accountCode: '401000', debit: 0, credit: 100 },
          ],
        },
        USER_ID,
        CTX,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.JOURNAL_ENTRY_NON_POSTING_ACCOUNT });
  });

  it('rejects when the entry date falls in a closed period', async () => {
    const { service } = buildService({ period: makePeriod('closed') });
    await expect(
      service.createDraft(
        asTenantId(ORG_ID),
        {
          journalCode: 'AC',
          entryDate: '2026-01-15',
          description: 'Closed period',
          lines: [
            { accountCode: '606000', debit: 100, credit: 0 },
            { accountCode: '401000', debit: 0, credit: 100 },
          ],
        },
        USER_ID,
        CTX,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.ACCOUNTING_PERIOD_CLOSED });
  });

  it('rejects when no period covers the date', async () => {
    const { service } = buildService({ period: null });
    await expect(
      service.createDraft(
        asTenantId(ORG_ID),
        {
          journalCode: 'AC',
          entryDate: '2026-01-15',
          description: 'No period',
          lines: [
            { accountCode: '606000', debit: 100, credit: 0 },
            { accountCode: '401000', debit: 0, credit: 100 },
          ],
        },
        USER_ID,
        CTX,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.ACCOUNTING_PERIOD_NOT_FOUND });
  });

  it('rejects when the journal does not exist', async () => {
    const { service } = buildService({ journal: null });
    await expect(
      service.createDraft(
        asTenantId(ORG_ID),
        {
          journalCode: 'XX',
          entryDate: '2026-01-15',
          description: 'Bad journal',
          lines: [
            { accountCode: '606000', debit: 100, credit: 0 },
            { accountCode: '401000', debit: 0, credit: 100 },
          ],
        },
        USER_ID,
        CTX,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.JOURNAL_NOT_FOUND });
  });
});

// ─── validate ──────────────────────────────────────────────────────────────

describe('EntriesService.validate', () => {
  it('marks a draft entry as validated', async () => {
    const { service, entryRepo, audit } = buildService();

    await service.validate(asTenantId(ORG_ID), ENTRY_ID, USER_ID, CTX);

    expect(entryRepo.updateStatus).toHaveBeenCalledWith(
      ENTRY_ID,
      'validated',
      expect.objectContaining({ validatedById: USER_ID }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'journals', action: 'journals.entry_validated' }),
    );
  });

  it('rejects validating an entry that is not in draft', async () => {
    const { service } = buildService({ entry: makeEntry({ status: 'validated' }) });
    await expect(
      service.validate(asTenantId(ORG_ID), ENTRY_ID, USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.JOURNAL_ENTRY_IMMUTABLE });
  });

  it('throws not-found when entry does not exist', async () => {
    const { service } = buildService({ entry: null });
    await expect(
      service.validate(asTenantId(ORG_ID), ENTRY_ID, USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.JOURNAL_ENTRY_NOT_FOUND });
  });
});

// ─── cancel (contre-passation) ─────────────────────────────────────────────

describe('EntriesService.cancel', () => {
  it('rejects cancelling an already-cancelled entry', async () => {
    const { service } = buildService({ entry: makeEntry({ status: 'cancelled' }) });
    await expect(
      service.cancel(asTenantId(ORG_ID), ENTRY_ID, 'oops', USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.JOURNAL_ENTRY_ALREADY_CANCELLED });
  });

  it('rejects cancelling a draft entry (use deleteDraft instead)', async () => {
    const { service } = buildService({ entry: makeEntry({ status: 'draft' }) });
    await expect(
      service.cancel(asTenantId(ORG_ID), ENTRY_ID, 'oops', USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.JOURNAL_ENTRY_IMMUTABLE });
  });
});

// ─── deleteDraft ───────────────────────────────────────────────────────────

describe('EntriesService.deleteDraft', () => {
  it('rejects deleting a validated entry', async () => {
    const { service } = buildService({ entry: makeEntry({ status: 'validated' }) });
    await expect(
      service.deleteDraft(asTenantId(ORG_ID), ENTRY_ID, USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.JOURNAL_ENTRY_IMMUTABLE });
  });
});
