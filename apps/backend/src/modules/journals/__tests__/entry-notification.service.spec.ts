import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { JournalEntryEntity } from '../entities/journal-entry.entity';
import { EntryNotificationService } from '../services/entry-notification.service';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const ENTRY_ID = '00000000-0000-4000-8000-000000000010';
const CTX = {
  userId: '00000000-0000-4000-8000-000000000002',
  organizationId: ORG_ID,
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

function makeEntry(overrides: Partial<JournalEntryEntity> = {}): JournalEntryEntity {
  return {
    id: ENTRY_ID,
    organizationId: ORG_ID,
    journalId: 'j-1',
    periodId: 'p-1',
    entryNumber: 7,
    entryDate: '2026-03-01',
    description: 'Achat de matériel',
    reference: null,
    status: 'validated',
    cancelsId: null,
    sourceType: 'manual',
    sourceImportSessionId: null,
    createdById: 'creator-1',
    validatedAt: new Date(),
    validatedById: 'expert-1',
    cancelledAt: null,
    cancelledById: null,
    cancelledReason: null,
    ...overrides,
  } as JournalEntryEntity;
}

interface Deps {
  email: { sendMail: jest.Mock };
  memberships: { listActiveByOrganizationWithRelations: jest.Mock };
  roles: { findByCode: jest.Mock };
  users: { findActiveById: jest.Mock };
  orgs: { findActiveById: jest.Mock };
  entryRepo: { findById: jest.Mock };
  lineRepo: { listByEntry: jest.Mock };
  signatures: { listByEntry: jest.Mock };
  journals: { findById: jest.Mock };
  periods: { findById: jest.Mock };
  accounts: { listByOrganization: jest.Mock };
  pdf: { generate: jest.Mock };
}

function buildService(opts: { entry?: JournalEntryEntity | null } = {}): {
  service: EntryNotificationService;
  deps: Deps;
} {
  const entry = opts.entry === undefined ? makeEntry() : opts.entry;
  const deps: Deps = {
    email: { sendMail: jest.fn().mockResolvedValue(undefined) },
    memberships: {
      listActiveByOrganizationWithRelations: jest.fn().mockResolvedValue([
        {
          roleId: 'role-cm',
          user: { email: 'chef@example.com' },
        },
        {
          roleId: 'role-ec',
          user: { email: 'expert@example.com' },
        },
        {
          roleId: 'role-other',
          user: { email: 'other@example.com' },
        },
      ]),
    },
    roles: {
      findByCode: jest.fn().mockImplementation((code: string) => {
        if (code === 'chef_mission') return Promise.resolve({ id: 'role-cm' });
        if (code === 'expert_comptable') return Promise.resolve({ id: 'role-ec' });
        return Promise.resolve(null);
      }),
    },
    users: {
      findActiveById: jest.fn().mockResolvedValue({ id: 'creator-1', email: 'creator@example.com' }),
    },
    orgs: { findActiveById: jest.fn().mockResolvedValue({ id: ORG_ID, name: 'Acme' }) },
    entryRepo: { findById: jest.fn().mockResolvedValue(entry) },
    lineRepo: { listByEntry: jest.fn().mockResolvedValue([]) },
    signatures: {
      listByEntry: jest.fn().mockResolvedValue([
        { id: 'sig-2', signerRole: 'expert_comptable', signedAt: new Date() },
      ]),
    },
    journals: { findById: jest.fn().mockResolvedValue({ code: 'AC', label: 'Achats' }) },
    periods: {
      findById: jest
        .fn()
        .mockResolvedValue({ label: 'Mars 2026', startDate: '2026-03-01', endDate: '2026-03-31' }),
    },
    accounts: { listByOrganization: jest.fn().mockResolvedValue([]) },
    pdf: { generate: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) },
  };

  const service = new EntryNotificationService(
    deps.email as never,
    deps.memberships as never,
    deps.roles as never,
    deps.users as never,
    deps.orgs as never,
    deps.entryRepo as never,
    deps.lineRepo as never,
    deps.signatures as never,
    deps.journals as never,
    deps.periods as never,
    deps.accounts as never,
    deps.pdf as never,
  );
  return { service, deps };
}

describe('EntryNotificationService.notifySubmittedForReview', () => {
  it('emails the chef_mission inbox(es)', async () => {
    const { service, deps } = buildService();
    await service.notifySubmittedForReview(ENTRY_ID, asTenantId(ORG_ID), CTX);

    expect(deps.email.sendMail).toHaveBeenCalledTimes(1);
    const call = deps.email.sendMail.mock.calls[0][0];
    expect(call.to).toEqual(['chef@example.com']);
    expect(call.subject).toMatch(/à revoir|a revoir/);
    expect(call.attachments).toBeUndefined();
  });

  it('silently skips when org has no chef_mission yet', async () => {
    const { service, deps } = buildService();
    deps.memberships.listActiveByOrganizationWithRelations.mockResolvedValueOnce([]);
    await service.notifySubmittedForReview(ENTRY_ID, asTenantId(ORG_ID), CTX);
    expect(deps.email.sendMail).not.toHaveBeenCalled();
  });

  it('swallows email failures (fire-and-forget)', async () => {
    const { service, deps } = buildService();
    deps.email.sendMail.mockRejectedValueOnce(new Error('SMTP down'));
    await expect(
      service.notifySubmittedForReview(ENTRY_ID, asTenantId(ORG_ID), CTX),
    ).resolves.toBeUndefined();
  });
});

describe('EntryNotificationService.notifyApproved', () => {
  it('emails the expert_comptable inbox(es)', async () => {
    const { service, deps } = buildService();
    await service.notifyApproved(ENTRY_ID, asTenantId(ORG_ID), CTX);
    const call = deps.email.sendMail.mock.calls[0][0];
    expect(call.to).toEqual(['expert@example.com']);
    expect(call.subject).toMatch(/prête pour signature|prete pour signature/);
  });
});

describe('EntryNotificationService.notifyRejected', () => {
  it('emails the entry creator with the rejection reason', async () => {
    const { service, deps } = buildService();
    await service.notifyRejected(ENTRY_ID, asTenantId(ORG_ID), 'wrong account', CTX);
    const call = deps.email.sendMail.mock.calls[0][0];
    expect(call.to).toBe('creator@example.com');
    expect(call.text).toContain('wrong account');
  });

  it('skips when creator user has been deleted', async () => {
    const { service, deps } = buildService();
    deps.users.findActiveById.mockResolvedValueOnce(null);
    await service.notifyRejected(ENTRY_ID, asTenantId(ORG_ID), 'reason', CTX);
    expect(deps.email.sendMail).not.toHaveBeenCalled();
  });
});

describe('EntryNotificationService.notifySigned', () => {
  it('generates a PDF and emails the creator with it attached', async () => {
    const { service, deps } = buildService();
    await service.notifySigned(ENTRY_ID, asTenantId(ORG_ID), CTX);

    expect(deps.pdf.generate).toHaveBeenCalledTimes(1);
    expect(deps.email.sendMail).toHaveBeenCalledTimes(1);
    const call = deps.email.sendMail.mock.calls[0][0];
    expect(call.to).toBe('creator@example.com');
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments[0].filename).toContain('AC-7.pdf');
    expect(call.attachments[0].contentType).toBe('application/pdf');
  });

  it('skips PDF + email when journal lookup fails', async () => {
    const { service, deps } = buildService();
    deps.journals.findById.mockResolvedValueOnce(null);
    await service.notifySigned(ENTRY_ID, asTenantId(ORG_ID), CTX);
    expect(deps.pdf.generate).not.toHaveBeenCalled();
    expect(deps.email.sendMail).not.toHaveBeenCalled();
  });

  it('skips when expert signature is not yet recorded', async () => {
    const { service, deps } = buildService();
    deps.signatures.listByEntry.mockResolvedValueOnce([]);
    await service.notifySigned(ENTRY_ID, asTenantId(ORG_ID), CTX);
    expect(deps.pdf.generate).not.toHaveBeenCalled();
  });
});
