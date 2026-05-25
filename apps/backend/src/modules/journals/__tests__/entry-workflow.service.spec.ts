import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { JournalEntryEntity } from '../entities/journal-entry.entity';
import type { WorkflowInstanceView } from '../../workflows/services/workflow.service';
import { EntryWorkflowService } from '../services/entry-workflow.service';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const ENTRY_ID = '00000000-0000-4000-8000-000000000010';
const INSTANCE_ID = '00000000-0000-4000-8000-000000000020';

const CTX = {
  userId: USER_ID,
  organizationId: ORG_ID,
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

function makeEntry(overrides: Partial<JournalEntryEntity> = {}): JournalEntryEntity {
  return {
    id: ENTRY_ID,
    organizationId: ORG_ID,
    journalId: 'j',
    periodId: 'p',
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

function makeInstance(
  currentStatus: 'draft' | 'in_review' | 'approved' | 'locked',
): WorkflowInstanceView {
  return {
    id: INSTANCE_ID,
    organizationId: ORG_ID,
    targetType: 'journal_entry',
    targetId: ENTRY_ID,
    currentStatus,
    startedBy: USER_ID,
    startedAt: new Date(),
    completedAt: null,
  };
}

interface BuildOpts {
  entry?: JournalEntryEntity | null;
  instance?: WorkflowInstanceView | null;
  signaturePresent?: 'chef_mission' | 'expert_comptable' | null;
}

function buildService(opts: BuildOpts = {}) {
  const entry = opts.entry === undefined ? makeEntry() : opts.entry;
  const entryRepo = {
    findById: jest.fn().mockResolvedValue(entry),
  };
  const lineRepo = {
    listByEntry: jest.fn().mockResolvedValue([]),
  };
  const signatures = {
    create: jest.fn().mockResolvedValue({}),
    findByEntryAndRole: jest.fn().mockImplementation((_org, _id, role: string) => {
      if (opts.signaturePresent === role) {
        return Promise.resolve({ id: 'sig', signerRole: role });
      }
      return Promise.resolve(null);
    }),
    listByEntry: jest.fn().mockResolvedValue([]),
  };
  const workflow = {
    startWorkflow: jest.fn().mockResolvedValue(opts.instance ?? makeInstance('draft')),
    transition: jest
      .fn()
      .mockImplementation(({ toStatus }: { toStatus: string }) =>
        Promise.resolve(makeInstance(toStatus as 'draft' | 'in_review' | 'approved' | 'locked')),
      ),
    findInstanceByTarget: jest.fn().mockResolvedValue(opts.instance ?? null),
    getHistory: jest.fn().mockResolvedValue([]),
  };
  const entries = {
    validate: jest.fn().mockResolvedValue({}),
  };
  const audit = { record: jest.fn().mockResolvedValue(null) };
  const dataSource = {
    transaction: jest.fn().mockImplementation(async (cb: () => Promise<unknown>) => cb()),
  };

  const service = new EntryWorkflowService(
    dataSource as never,
    entries as never,
    entryRepo as never,
    lineRepo as never,
    signatures as never,
    workflow as never,
    audit as never,
  );

  return { service, entryRepo, lineRepo, signatures, workflow, entries, audit, dataSource };
}

describe('EntryWorkflowService.submitForReview', () => {
  it('transitions draft entry to in_review', async () => {
    const { service, workflow } = buildService();

    const result = await service.submitForReview({
      organizationId: asTenantId(ORG_ID),
      entryId: ENTRY_ID,
      actorId: USER_ID,
      ctx: CTX,
    });

    expect(workflow.startWorkflow).toHaveBeenCalled();
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'in_review' }),
    );
    expect(result.workflow.currentStatus).toBe('in_review');
  });

  it('rejects when entry not in draft status', async () => {
    const { service } = buildService({ entry: makeEntry({ status: 'validated' }) });

    await expect(
      service.submitForReview({
        organizationId: asTenantId(ORG_ID),
        entryId: ENTRY_ID,
        actorId: USER_ID,
        ctx: CTX,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS });
  });

  it('throws not-found when entry missing', async () => {
    const { service } = buildService({ entry: null });

    await expect(
      service.submitForReview({
        organizationId: asTenantId(ORG_ID),
        entryId: ENTRY_ID,
        actorId: USER_ID,
        ctx: CTX,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.JOURNAL_ENTRY_NOT_FOUND });
  });
});

describe('EntryWorkflowService.approve', () => {
  it('records chef_mission signature and transitions to approved', async () => {
    const { service, signatures, workflow } = buildService({
      instance: makeInstance('in_review'),
    });

    const result = await service.approve({
      organizationId: asTenantId(ORG_ID),
      entryId: ENTRY_ID,
      actorId: USER_ID,
      comment: 'OK',
      ctx: CTX,
    });

    expect(signatures.create).toHaveBeenCalledWith(
      expect.objectContaining({ signerRole: 'chef_mission' }),
    );
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'approved' }),
    );
    expect(result.workflow.currentStatus).toBe('approved');
  });

  it('rejects when workflow not in in_review', async () => {
    const { service } = buildService({ instance: makeInstance('approved') });

    await expect(
      service.approve({
        organizationId: asTenantId(ORG_ID),
        entryId: ENTRY_ID,
        actorId: USER_ID,
        ctx: CTX,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS });
  });

  it('rejects when chef_mission already signed', async () => {
    const { service } = buildService({
      instance: makeInstance('in_review'),
      signaturePresent: 'chef_mission',
    });

    await expect(
      service.approve({
        organizationId: asTenantId(ORG_ID),
        entryId: ENTRY_ID,
        actorId: USER_ID,
        ctx: CTX,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTRY_SIGNATURE_ALREADY_SIGNED });
  });
});

describe('EntryWorkflowService.reject', () => {
  it('requires a reason of >= 3 chars', async () => {
    const { service } = buildService({ instance: makeInstance('in_review') });

    await expect(
      service.reject({
        organizationId: asTenantId(ORG_ID),
        entryId: ENTRY_ID,
        actorId: USER_ID,
        reason: '  ',
        ctx: CTX,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTRY_SIGNATURE_REJECT_REASON_REQUIRED });
  });

  it('transitions in_review back to draft', async () => {
    const { service, workflow } = buildService({ instance: makeInstance('in_review') });

    await service.reject({
      organizationId: asTenantId(ORG_ID),
      entryId: ENTRY_ID,
      actorId: USER_ID,
      reason: 'invalid account',
      ctx: CTX,
    });

    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'draft', comment: 'invalid account' }),
    );
  });

  it('transitions approved back to in_review for rework', async () => {
    const { service, workflow } = buildService({ instance: makeInstance('approved') });

    await service.reject({
      organizationId: asTenantId(ORG_ID),
      entryId: ENTRY_ID,
      actorId: USER_ID,
      reason: 'rework lines',
      ctx: CTX,
    });

    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'in_review' }),
    );
  });

  it('rejects when workflow already locked', async () => {
    const { service } = buildService({ instance: makeInstance('locked') });

    await expect(
      service.reject({
        organizationId: asTenantId(ORG_ID),
        entryId: ENTRY_ID,
        actorId: USER_ID,
        reason: 'too late',
        ctx: CTX,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS });
  });
});

describe('EntryWorkflowService.sign', () => {
  it('validates entry, records expert signature, locks workflow', async () => {
    const { service, signatures, workflow, entries } = buildService({
      instance: makeInstance('approved'),
    });

    const result = await service.sign({
      organizationId: asTenantId(ORG_ID),
      entryId: ENTRY_ID,
      actorId: USER_ID,
      ctx: CTX,
    });

    expect(entries.validate).toHaveBeenCalledWith(ORG_ID, ENTRY_ID, USER_ID, CTX);
    expect(signatures.create).toHaveBeenCalledWith(
      expect.objectContaining({ signerRole: 'expert_comptable' }),
    );
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'locked' }),
    );
    expect(result.workflow.currentStatus).toBe('locked');
  });

  it('rejects when workflow not approved', async () => {
    const { service } = buildService({ instance: makeInstance('in_review') });

    await expect(
      service.sign({
        organizationId: asTenantId(ORG_ID),
        entryId: ENTRY_ID,
        actorId: USER_ID,
        ctx: CTX,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS });
  });

  it('rejects when entry already validated', async () => {
    const { service } = buildService({
      entry: makeEntry({ status: 'validated' }),
      instance: makeInstance('approved'),
    });

    await expect(
      service.sign({
        organizationId: asTenantId(ORG_ID),
        entryId: ENTRY_ID,
        actorId: USER_ID,
        ctx: CTX,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS });
  });

  it('rejects when expert_comptable already signed', async () => {
    const { service } = buildService({
      instance: makeInstance('approved'),
      signaturePresent: 'expert_comptable',
    });

    await expect(
      service.sign({
        organizationId: asTenantId(ORG_ID),
        entryId: ENTRY_ID,
        actorId: USER_ID,
        ctx: CTX,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTRY_SIGNATURE_ALREADY_SIGNED });
  });
});

describe('EntryWorkflowService.getHistory', () => {
  it('returns workflow null when no instance started', async () => {
    const { service } = buildService({ instance: null });

    const history = await service.getHistory(asTenantId(ORG_ID), ENTRY_ID);

    expect(history.workflow).toBeNull();
    expect(history.events).toEqual([]);
  });

  it('returns instance + events when started', async () => {
    const { service, workflow } = buildService({ instance: makeInstance('approved') });
    workflow.getHistory.mockResolvedValueOnce([
      {
        id: 'e1',
        fromStatus: 'draft',
        toStatus: 'in_review',
        actorId: USER_ID,
        comment: null,
        occurredAt: new Date(),
      },
    ]);

    const history = await service.getHistory(asTenantId(ORG_ID), ENTRY_ID);

    expect(history.workflow?.currentStatus).toBe('approved');
    expect(history.events).toHaveLength(1);
  });
});
