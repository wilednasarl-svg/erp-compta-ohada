import type { DataSource } from 'typeorm';

import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { AuditTrailService } from '../../audit/services/audit-trail.service';
import type { JournalEntryLineEntity } from '../../journals/entities/journal-entry-line.entity';
import type { JournalEntryEntity } from '../../journals/entities/journal-entry.entity';
import type { JournalEntryLineRepository } from '../../journals/repositories/journal-entry-line.repository';
import type { JournalEntryRepository } from '../../journals/repositories/journal-entry.repository';
import type { EntriesService } from '../../journals/services/entries.service';
import type { WorkflowInstanceView, WorkflowService } from '../../workflows/services/workflow.service';
import type { EntrySignatureEntity } from '../entities/entry-signature.entity';
import type { EntrySignatureRepository } from '../repositories/entry-signature.repository';
import { JournalSignatureService } from '../services/journal-signature.service';
import type { SignerRole } from '../types/journal-signature.types';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const ENTRY_ID = '00000000-0000-4000-8000-000000000003';
const INSTANCE_ID = '00000000-0000-4000-8000-000000000004';

const CTX = {
  userId: USER_ID,
  organizationId: ORG_ID,
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

function makeEntry(status = 'draft'): JournalEntryEntity {
  return {
    id: ENTRY_ID,
    organizationId: ORG_ID,
    journalId: '00000000-0000-4000-8000-0000000000aa',
    periodId: '00000000-0000-4000-8000-0000000000bb',
    entryNumber: 42,
    entryDate: '2026-05-25',
    description: 'Test entry',
    reference: 'REF-1',
    status,
    cancelsId: null,
    sourceType: 'manual',
    sourceImportSessionId: null,
    createdById: USER_ID,
    validatedAt: null,
    validatedById: null,
    cancelledAt: null,
    cancelledById: null,
    cancelledReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lines: [],
  } as unknown as JournalEntryEntity;
}

function makeLines(): JournalEntryLineEntity[] {
  return [
    {
      id: 'l1',
      accountId: 'a1',
      position: 1,
      debit: '100.00',
      credit: '0.00',
      description: null,
    } as unknown as JournalEntryLineEntity,
    {
      id: 'l2',
      accountId: 'a2',
      position: 2,
      debit: '0.00',
      credit: '100.00',
      description: null,
    } as unknown as JournalEntryLineEntity,
  ];
}

function makeInstance(status: WorkflowInstanceView['currentStatus']): WorkflowInstanceView {
  return {
    id: INSTANCE_ID,
    organizationId: ORG_ID,
    targetType: 'journal_entry',
    targetId: ENTRY_ID,
    currentStatus: status,
    startedBy: USER_ID,
    startedAt: new Date(),
    completedAt: status === 'locked' ? new Date() : null,
  };
}

function makeSignature(role: SignerRole): EntrySignatureEntity {
  return {
    id: `sig-${role}`,
    organizationId: ORG_ID,
    journalEntryId: ENTRY_ID,
    signerId: USER_ID,
    signerRole: role,
    signatureHash: 'a'.repeat(64),
    comment: null,
    signedAt: new Date(),
  } as unknown as EntrySignatureEntity;
}

interface Mocks {
  dataSource: jest.Mocked<Pick<DataSource, 'transaction'>>;
  entries: jest.Mocked<Pick<EntriesService, 'validate'>>;
  workflow: jest.Mocked<
    Pick<WorkflowService, 'startWorkflow' | 'transition' | 'findInstanceByTarget' | 'getHistory'>
  >;
  signatures: jest.Mocked<
    Pick<EntrySignatureRepository, 'create' | 'findByEntryAndRole' | 'listByEntry'>
  >;
  entryRepo: jest.Mocked<Pick<JournalEntryRepository, 'findById'>>;
  lineRepo: jest.Mocked<Pick<JournalEntryLineRepository, 'listByEntry'>>;
  audit: jest.Mocked<Pick<AuditTrailService, 'record'>>;
}

function buildService(overrides: Partial<Mocks> = {}) {
  const dataSource = {
    transaction: jest.fn((cb: (m: unknown) => Promise<unknown>) => cb({} as never)),
  } as unknown as jest.Mocked<DataSource>;

  const entries = {
    validate: jest.fn().mockResolvedValue(makeEntry('validated')),
  } as unknown as jest.Mocked<EntriesService>;

  const workflow = {
    startWorkflow: jest.fn().mockResolvedValue(makeInstance('draft')),
    transition: jest.fn().mockImplementation(({ toStatus }: { toStatus: string }) =>
      Promise.resolve(makeInstance(toStatus as WorkflowInstanceView['currentStatus'])),
    ),
    findInstanceByTarget: jest.fn().mockResolvedValue(null),
    getHistory: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<WorkflowService>;

  const signatures = {
    create: jest.fn().mockImplementation((input: { signerRole: SignerRole }) =>
      Promise.resolve(makeSignature(input.signerRole)),
    ),
    findByEntryAndRole: jest.fn().mockResolvedValue(null),
    listByEntry: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<EntrySignatureRepository>;

  const entryRepo = {
    findById: jest.fn().mockResolvedValue(makeEntry('draft')),
  } as unknown as jest.Mocked<JournalEntryRepository>;

  const lineRepo = {
    listByEntry: jest.fn().mockResolvedValue(makeLines()),
  } as unknown as jest.Mocked<JournalEntryLineRepository>;

  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditTrailService>;

  Object.assign({ dataSource, entries, workflow, signatures, entryRepo, lineRepo, audit }, overrides);

  const service = new JournalSignatureService(
    dataSource,
    entries as unknown as EntriesService,
    workflow as unknown as WorkflowService,
    signatures as unknown as EntrySignatureRepository,
    entryRepo as unknown as JournalEntryRepository,
    lineRepo as unknown as JournalEntryLineRepository,
    audit as unknown as AuditTrailService,
  );

  return { service, dataSource, entries, workflow, signatures, entryRepo, lineRepo, audit };
}

// ─── submitForReview ────────────────────────────────────────────────────────

describe('JournalSignatureService.submitForReview', () => {
  it('starts the workflow and transitions draft → in_review', async () => {
    const { service, workflow, audit } = buildService();

    const view = await service.submitForReview(
      ORG_ID as never,
      ENTRY_ID,
      'Ready for review',
      USER_ID,
      CTX,
    );

    expect(workflow.startWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        targetType: 'journal_entry',
        targetId: ENTRY_ID,
      }),
    );
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: INSTANCE_ID, toStatus: 'in_review' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'journals', action: 'entry_submitted_for_review' }),
    );
    expect(view.workflow.currentStatus).toBe('in_review');
  });

  it('rejects when entry is not in draft status', async () => {
    const { service, entryRepo } = buildService();
    entryRepo.findById.mockResolvedValue(makeEntry('validated'));

    await expect(
      service.submitForReview(ORG_ID as never, ENTRY_ID, null, USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS });
  });

  it('throws JOURNAL_ENTRY_NOT_FOUND when entry is missing', async () => {
    const { service, entryRepo } = buildService();
    entryRepo.findById.mockResolvedValue(null);

    await expect(
      service.submitForReview(ORG_ID as never, ENTRY_ID, null, USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.JOURNAL_ENTRY_NOT_FOUND });
  });
});

// ─── approve ────────────────────────────────────────────────────────────────

describe('JournalSignatureService.approve', () => {
  it('records chef_mission signature and transitions in_review → approved', async () => {
    const { service, workflow, signatures, audit } = buildService();
    workflow.findInstanceByTarget.mockResolvedValue(makeInstance('in_review'));

    const view = await service.approve(ORG_ID as never, ENTRY_ID, 'OK pour moi', USER_ID, CTX);

    expect(signatures.create).toHaveBeenCalledWith(
      expect.objectContaining({
        journalEntryId: ENTRY_ID,
        signerRole: 'chef_mission',
        signerId: USER_ID,
      }),
    );
    const createArg = (signatures.create as jest.Mock).mock.calls[0][0];
    expect(createArg.signatureHash).toMatch(/^[0-9a-f]{64}$/);
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'approved' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'entry_approved' }),
    );
    expect(view.workflow.currentStatus).toBe('approved');
  });

  it('rejects if workflow is not in_review', async () => {
    const { service, workflow } = buildService();
    workflow.findInstanceByTarget.mockResolvedValue(makeInstance('approved'));

    await expect(
      service.approve(ORG_ID as never, ENTRY_ID, null, USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS });
  });

  it('rejects if a chef_mission signature already exists', async () => {
    const { service, workflow, signatures } = buildService();
    workflow.findInstanceByTarget.mockResolvedValue(makeInstance('in_review'));
    signatures.findByEntryAndRole.mockResolvedValue(makeSignature('chef_mission'));

    await expect(
      service.approve(ORG_ID as never, ENTRY_ID, null, USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTRY_SIGNATURE_ALREADY_SIGNED });
  });
});

// ─── reject ─────────────────────────────────────────────────────────────────

describe('JournalSignatureService.reject', () => {
  it('transitions in_review → draft with the rejection reason', async () => {
    const { service, workflow, audit } = buildService();
    workflow.findInstanceByTarget.mockResolvedValue(makeInstance('in_review'));

    const view = await service.reject(
      ORG_ID as never,
      ENTRY_ID,
      'Missing supporting doc',
      USER_ID,
      CTX,
    );

    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'draft', comment: 'Missing supporting doc' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'entry_rejected' }),
    );
    expect(view.workflow.currentStatus).toBe('draft');
  });

  it('rejects empty reason', async () => {
    const { service } = buildService();

    await expect(
      service.reject(ORG_ID as never, ENTRY_ID, '', USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTRY_SIGNATURE_REJECT_REASON_REQUIRED });
  });

  it('rejects when workflow is not in_review', async () => {
    const { service, workflow } = buildService();
    workflow.findInstanceByTarget.mockResolvedValue(makeInstance('approved'));

    await expect(
      service.reject(ORG_ID as never, ENTRY_ID, 'late', USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS });
  });
});

// ─── sign ───────────────────────────────────────────────────────────────────

describe('JournalSignatureService.sign', () => {
  it('records expert_comptable signature, validates entry, locks workflow', async () => {
    const { service, workflow, entries, signatures, audit } = buildService();
    workflow.findInstanceByTarget.mockResolvedValue(makeInstance('approved'));

    const view = await service.sign(ORG_ID as never, ENTRY_ID, 'Signed', USER_ID, CTX);

    expect(signatures.create).toHaveBeenCalledWith(
      expect.objectContaining({ signerRole: 'expert_comptable' }),
    );
    expect(entries.validate).toHaveBeenCalledWith(ORG_ID, ENTRY_ID, USER_ID, CTX);
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'locked' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'entry_signed' }),
    );
    expect(view.workflow.currentStatus).toBe('locked');
  });

  it('rejects sign when workflow is not in approved', async () => {
    const { service, workflow } = buildService();
    workflow.findInstanceByTarget.mockResolvedValue(makeInstance('in_review'));

    await expect(
      service.sign(ORG_ID as never, ENTRY_ID, null, USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS });
  });

  it('rejects sign when expert_comptable signature exists', async () => {
    const { service, workflow, signatures } = buildService();
    workflow.findInstanceByTarget.mockResolvedValue(makeInstance('approved'));
    signatures.findByEntryAndRole.mockResolvedValue(makeSignature('expert_comptable'));

    await expect(
      service.sign(ORG_ID as never, ENTRY_ID, null, USER_ID, CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.ENTRY_SIGNATURE_ALREADY_SIGNED });
  });
});

// ─── getStatus ─────────────────────────────────────────────────────────────

describe('JournalSignatureService.getStatus', () => {
  it('returns null when no workflow has been started for the entry', async () => {
    const { service } = buildService();

    const result = await service.getStatus(ORG_ID as never, ENTRY_ID);
    expect(result).toBeNull();
  });

  it('returns workflow + signatures + history when present', async () => {
    const { service, workflow, signatures } = buildService();
    workflow.findInstanceByTarget.mockResolvedValue(makeInstance('approved'));
    signatures.listByEntry.mockResolvedValue([makeSignature('chef_mission')]);
    workflow.getHistory.mockResolvedValue([]);

    const result = await service.getStatus(ORG_ID as never, ENTRY_ID);
    expect(result).not.toBeNull();
    expect(result!.workflow.currentStatus).toBe('approved');
    expect(result!.signatures).toHaveLength(1);
    expect(result!.signatures[0].signerRole).toBe('chef_mission');
  });

  it('throws JOURNAL_ENTRY_NOT_FOUND when entry is missing', async () => {
    const { service, entryRepo } = buildService();
    entryRepo.findById.mockResolvedValue(null);

    await expect(service.getStatus(ORG_ID as never, ENTRY_ID)).rejects.toMatchObject({
      code: ERROR_CODES.JOURNAL_ENTRY_NOT_FOUND,
    });
  });
});

// ─── signature hash determinism ────────────────────────────────────────────

describe('signature hash', () => {
  it('produces a deterministic 64-hex sha256 for stable entry content', async () => {
    const { service, workflow, signatures } = buildService();
    workflow.findInstanceByTarget.mockResolvedValue(makeInstance('in_review'));

    await service.approve(ORG_ID as never, ENTRY_ID, null, USER_ID, CTX);
    const firstHash = (signatures.create as jest.Mock).mock.calls[0][0].signatureHash;

    (signatures.create as jest.Mock).mockClear();
    (signatures.findByEntryAndRole as jest.Mock).mockResolvedValue(null);
    workflow.findInstanceByTarget.mockResolvedValue(makeInstance('in_review'));

    await service.approve(ORG_ID as never, ENTRY_ID, null, USER_ID, CTX);
    const secondHash = (signatures.create as jest.Mock).mock.calls[0][0].signatureHash;

    expect(firstHash).toBe(secondHash);
    expect(firstHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
