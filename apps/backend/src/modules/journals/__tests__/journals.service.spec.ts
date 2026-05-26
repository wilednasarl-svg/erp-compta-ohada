import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { JournalEntity } from '../entities/journal.entity';
import { JournalsService } from '../services/journals.service';
import { STANDARD_JOURNALS } from '../types/journal.types';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const JOURNAL_ID = '00000000-0000-4000-8000-000000000003';

const CTX = {
  userId: USER_ID,
  organizationId: ORG_ID,
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

function makeJournal(overrides: Partial<JournalEntity> = {}): JournalEntity {
  return {
    id: JOURNAL_ID,
    organizationId: ORG_ID,
    code: 'AC',
    label: 'Journal des Achats',
    kind: 'AC',
    nextEntryNumber: 1,
    isActive: true,
    defaultAccountId: null,
    ...overrides,
  } as JournalEntity;
}

function buildService(
  overrides: {
    existingJournal?: JournalEntity | null;
    createResult?: JournalEntity;
  } = {},
) {
  const existingJournal =
    overrides.existingJournal === undefined ? makeJournal() : overrides.existingJournal;

  const createResult: JournalEntity =
    overrides.createResult ??
    makeJournal({
      id: '00000000-0000-4000-8000-000000000099',
      code: 'BQ-02',
      label: 'Banque secondaire',
      kind: 'BQ',
    });

  const journalRepo = {
    findByCode: jest.fn().mockResolvedValue(existingJournal),
    listByOrganization: jest.fn().mockResolvedValue([makeJournal()]),
    create: jest.fn().mockResolvedValue(createResult),
  };

  const audit = { record: jest.fn().mockResolvedValue(null) };

  const service = new JournalsService(journalRepo as never, audit as never);

  return { service, journalRepo, audit };
}

// ─── findByCode ────────────────────────────────────────────────────────────

describe('JournalsService.findByCode', () => {
  it('returns the journal when found', async () => {
    const { service } = buildService({ existingJournal: makeJournal() });

    const result = await service.findByCode(asTenantId(ORG_ID), 'AC');

    expect(result.code).toBe('AC');
    expect(result.organizationId).toBe(ORG_ID);
  });

  it('throws JOURNAL_NOT_FOUND when code does not exist', async () => {
    const { service } = buildService({ existingJournal: null });

    await expect(service.findByCode(asTenantId(ORG_ID), 'UNKNOWN')).rejects.toMatchObject({
      code: ERROR_CODES.JOURNAL_NOT_FOUND,
    });
  });
});

// ─── createCustom ──────────────────────────────────────────────────────────

describe('JournalsService.createCustom', () => {
  it('happy path: creates a custom journal and emits audit', async () => {
    const { service, journalRepo, audit } = buildService({ existingJournal: null });

    const result = await service.createCustom(
      asTenantId(ORG_ID),
      { code: 'BQ-02', label: 'Banque secondaire', kind: 'BQ' },
      USER_ID,
      CTX,
    );

    expect(journalRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'BQ-02', kind: 'BQ', organizationId: ORG_ID }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'journals.journal_created',
        entityType: 'journal',
        metadata: expect.objectContaining({ code: 'BQ-02', kind: 'BQ' }),
      }),
    );
    expect(result.code).toBe('BQ-02');
  });

  it('rejects with JOURNAL_CODE_TAKEN when a journal with that code already exists', async () => {
    const { service, journalRepo } = buildService({
      existingJournal: makeJournal({ code: 'BQ-02' }),
    });

    await expect(
      service.createCustom(
        asTenantId(ORG_ID),
        { code: 'BQ-02', label: 'Duplicate', kind: 'BQ' },
        USER_ID,
        CTX,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.JOURNAL_CODE_TAKEN });

    expect(journalRepo.create).not.toHaveBeenCalled();
    expect(journalRepo.create).not.toHaveBeenCalled();
  });

  it('forwards defaultAccountId when provided', async () => {
    const { service, journalRepo } = buildService({ existingJournal: null });
    const acctId = '00000000-0000-4000-8000-000000000088';

    await service.createCustom(
      asTenantId(ORG_ID),
      { code: 'BQ-03', label: 'Banque tertiaire', kind: 'BQ', defaultAccountId: acctId },
      USER_ID,
      CTX,
    );

    expect(journalRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ defaultAccountId: acctId }),
    );
  });
});

// ─── seedStandardJournals ──────────────────────────────────────────────────

describe('JournalsService.seedStandardJournals', () => {
  it(`creates exactly ${STANDARD_JOURNALS.length} journals in the transaction manager`, async () => {
    const { service, journalRepo } = buildService({ existingJournal: null });

    const fakeManager = {} as never;

    await service.seedStandardJournals(asTenantId(ORG_ID), fakeManager);

    expect(journalRepo.create).toHaveBeenCalledTimes(STANDARD_JOURNALS.length);
  });

  it('seeds AC, VE, BQ, CA, OD, PA codes in order', async () => {
    const { service, journalRepo } = buildService({ existingJournal: null });

    await service.seedStandardJournals(asTenantId(ORG_ID), {} as never);

    const codes = journalRepo.create.mock.calls.map((c: [Record<string, unknown>]) => c[0].code);
    expect(codes).toEqual(['AC', 'VE', 'BQ', 'CA', 'OD', 'PA']);
  });

  it('passes the manager as second arg to each repo.create call', async () => {
    const { service, journalRepo } = buildService({ existingJournal: null });
    const fakeManager = { marker: 'txn' } as never;

    await service.seedStandardJournals(asTenantId(ORG_ID), fakeManager);

    for (const call of journalRepo.create.mock.calls as unknown[][]) {
      expect(call[1]).toBe(fakeManager);
    }
  });
});
