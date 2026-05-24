import type { DataSource } from 'typeorm';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AuditTrailService } from '../../audit/services/audit-trail.service';
import type { JournalEntryLineEntity } from '../entities/journal-entry-line.entity';
import type { PartnerLetteringEntity } from '../entities/partner-lettering.entity';
import type { JournalEntryLineRepository } from '../repositories/journal-entry-line.repository';
import type { PartnerLetteringRepository } from '../repositories/partner-lettering.repository';
import { LetteringService } from '../services/lettering.service';

/**
 * Unit tests for `LetteringService` (projet-ferme-3n3).
 *
 * Covers the service invariants — DB constraints and triggers are
 * exercised in the e2e suite.
 */

const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
const USER_ID = '00000000-0000-4000-8000-000000000002';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000003';
const CTX = { ipAddress: '127.0.0.1', userAgent: 'jest' } as const;

function partnerAccount(code = '411000', label = 'CLIENT X') {
  return { id: ACCOUNT_ID, code, label, class: 4 } as never;
}

function buildLine(
  id: string,
  overrides: Partial<JournalEntryLineEntity> = {},
): JournalEntryLineEntity {
  return {
    id,
    organizationId: ORG_ID,
    journalEntryId: 'entry-1',
    accountId: ACCOUNT_ID,
    account: partnerAccount(),
    position: 1,
    description: null,
    debit: '0',
    credit: '0',
    lineLetter: null,
    letteringId: null,
    createdAt: new Date('2026-01-15'),
    ...overrides,
  } as unknown as JournalEntryLineEntity;
}

interface Harness {
  service: LetteringService;
  letteringRepo: {
    create: jest.Mock;
    findById: jest.Mock;
    listForOrg: jest.Mock;
    nextLetteringCode: jest.Mock;
    markBroken: jest.Mock;
  };
  lineRepo: {
    listForLetteringCheck: jest.Mock;
    attachLettering: jest.Mock;
    detachLettering: jest.Mock;
    listByAccountAndOrg: jest.Mock;
  };
  audit: { record: jest.Mock };
}

function buildHarness(): Harness {
  const dataSource = {
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => cb({} as never)),
  } as unknown as DataSource;
  const letteringRepo = {
    create: jest.fn(),
    findById: jest.fn(),
    listForOrg: jest.fn(),
    nextLetteringCode: jest.fn().mockResolvedValue('A0001'),
    markBroken: jest.fn().mockResolvedValue(undefined),
  };
  const lineRepo = {
    listForLetteringCheck: jest.fn(),
    attachLettering: jest.fn().mockResolvedValue(undefined),
    detachLettering: jest.fn().mockResolvedValue(2),
    listByAccountAndOrg: jest.fn().mockResolvedValue([]),
  };
  const audit = { record: jest.fn().mockResolvedValue(null) };
  const service = new LetteringService(
    dataSource,
    letteringRepo as unknown as PartnerLetteringRepository,
    lineRepo as unknown as JournalEntryLineRepository,
    audit as unknown as AuditTrailService,
  );
  return { service, letteringRepo, lineRepo, audit };
}

describe('LetteringService.create', () => {
  it('creates a balanced lettering on 2 lines (debit + credit on same client account)', async () => {
    const h = buildHarness();
    h.lineRepo.listForLetteringCheck.mockResolvedValue([
      { line: buildLine('line-1', { debit: '1000.00', credit: '0' }), entryStatus: 'validated' },
      { line: buildLine('line-2', { debit: '0', credit: '1000.00' }), entryStatus: 'validated' },
    ]);
    h.letteringRepo.create.mockResolvedValue({
      id: 'lettering-1',
      letteringCode: 'A0001',
      partnerAccountId: ACCOUNT_ID,
      partnerAccount: partnerAccount(),
      partnerLabel: '411000 CLIENT X',
      totalAmount: '1000.00',
      status: 'complete',
      createdById: USER_ID,
      createdAt: new Date(),
      completedAt: new Date(),
      brokenAt: null,
      brokenReason: null,
      brokenById: null,
      organizationId: ORG_ID,
    } as unknown as PartnerLetteringEntity);

    const result = await h.service.create(
      ORG_ID,
      { journalEntryLineIds: ['line-1', 'line-2'] },
      USER_ID,
      CTX,
    );

    expect(result.letteringCode).toBe('A0001');
    expect(result.status).toBe('complete');
    expect(result.totalAmount).toBe('1000.00');
    expect(result.lineIds).toEqual(['line-1', 'line-2']);
    expect(h.lineRepo.attachLettering).toHaveBeenCalledWith(
      ['line-1', 'line-2'],
      'lettering-1',
      ORG_ID,
      expect.anything(),
    );
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'journals',
        action: 'lettering_created',
        legacyEventType: 'journals.lettering.created',
      }),
    );
  });

  it('refuses LETTERING_LINES_REQUIRED when fewer than 2 lines are provided', async () => {
    const h = buildHarness();
    await expect(
      h.service.create(ORG_ID, { journalEntryLineIds: ['line-1'] }, USER_ID, CTX),
    ).rejects.toMatchObject({ code: 'LETTERING_LINES_REQUIRED' });
    expect(h.lineRepo.listForLetteringCheck).not.toHaveBeenCalled();
  });

  it('refuses LETTERING_LINES_REQUIRED when some lines do not exist in this tenant', async () => {
    const h = buildHarness();
    h.lineRepo.listForLetteringCheck.mockResolvedValue([
      { line: buildLine('line-1', { debit: '100', credit: '0' }), entryStatus: 'validated' },
    ]);
    await expect(
      h.service.create(ORG_ID, { journalEntryLineIds: ['line-1', 'line-2'] }, USER_ID, CTX),
    ).rejects.toMatchObject({ code: 'LETTERING_LINES_REQUIRED' });
  });

  it('refuses LETTERING_MIXED_ACCOUNTS when lines span 2 accounts', async () => {
    const h = buildHarness();
    h.lineRepo.listForLetteringCheck.mockResolvedValue([
      {
        line: buildLine('line-1', { accountId: 'acc-A', debit: '100', credit: '0' }),
        entryStatus: 'validated',
      },
      {
        line: buildLine('line-2', { accountId: 'acc-B', debit: '0', credit: '100' }),
        entryStatus: 'validated',
      },
    ]);
    await expect(
      h.service.create(ORG_ID, { journalEntryLineIds: ['line-1', 'line-2'] }, USER_ID, CTX),
    ).rejects.toMatchObject({ code: 'LETTERING_MIXED_ACCOUNTS' });
  });

  it('refuses LETTERING_NOT_PARTNER_ACCOUNT on a non-4xx account (e.g. 707 revenu)', async () => {
    const h = buildHarness();
    const revenue = { id: ACCOUNT_ID, code: '707000', label: 'Ventes', class: 7 };
    h.lineRepo.listForLetteringCheck.mockResolvedValue([
      {
        line: buildLine('line-1', { account: revenue as never, debit: '100', credit: '0' }),
        entryStatus: 'validated',
      },
      {
        line: buildLine('line-2', { account: revenue as never, debit: '0', credit: '100' }),
        entryStatus: 'validated',
      },
    ]);
    await expect(
      h.service.create(ORG_ID, { journalEntryLineIds: ['line-1', 'line-2'] }, USER_ID, CTX),
    ).rejects.toMatchObject({ code: 'LETTERING_NOT_PARTNER_ACCOUNT' });
  });

  it('refuses LETTERING_LINE_NOT_VALIDATED when a parent entry is still draft', async () => {
    const h = buildHarness();
    h.lineRepo.listForLetteringCheck.mockResolvedValue([
      { line: buildLine('line-1', { debit: '100', credit: '0' }), entryStatus: 'draft' },
      { line: buildLine('line-2', { debit: '0', credit: '100' }), entryStatus: 'validated' },
    ]);
    await expect(
      h.service.create(ORG_ID, { journalEntryLineIds: ['line-1', 'line-2'] }, USER_ID, CTX),
    ).rejects.toMatchObject({ code: 'LETTERING_LINE_NOT_VALIDATED' });
  });

  it('refuses LETTERING_LINE_ALREADY_USED when a line already has lettering_id set', async () => {
    const h = buildHarness();
    h.lineRepo.listForLetteringCheck.mockResolvedValue([
      {
        line: buildLine('line-1', { debit: '100', credit: '0', letteringId: 'prev-1' }),
        entryStatus: 'validated',
      },
      { line: buildLine('line-2', { debit: '0', credit: '100' }), entryStatus: 'validated' },
    ]);
    await expect(
      h.service.create(ORG_ID, { journalEntryLineIds: ['line-1', 'line-2'] }, USER_ID, CTX),
    ).rejects.toMatchObject({ code: 'LETTERING_LINE_ALREADY_USED' });
  });

  it('refuses LETTERING_UNBALANCED when sum(debit) != sum(credit)', async () => {
    const h = buildHarness();
    h.lineRepo.listForLetteringCheck.mockResolvedValue([
      { line: buildLine('line-1', { debit: '100', credit: '0' }), entryStatus: 'validated' },
      { line: buildLine('line-2', { debit: '0', credit: '90' }), entryStatus: 'validated' },
    ]);
    await expect(
      h.service.create(ORG_ID, { journalEntryLineIds: ['line-1', 'line-2'] }, USER_ID, CTX),
    ).rejects.toMatchObject({
      code: 'LETTERING_UNBALANCED',
      details: { totalDebit: 100, totalCredit: 90 },
    });
  });

  it('accepts a multi-line lettering (3 invoices paid by 1 receipt) when the sum balances', async () => {
    const h = buildHarness();
    h.lineRepo.listForLetteringCheck.mockResolvedValue([
      { line: buildLine('inv-1', { debit: '400', credit: '0' }), entryStatus: 'validated' },
      { line: buildLine('inv-2', { debit: '300', credit: '0' }), entryStatus: 'validated' },
      { line: buildLine('inv-3', { debit: '300', credit: '0' }), entryStatus: 'validated' },
      { line: buildLine('pay-1', { debit: '0', credit: '1000' }), entryStatus: 'validated' },
    ]);
    h.letteringRepo.create.mockResolvedValue({
      id: 'lettering-2',
      letteringCode: 'A0001',
      partnerAccountId: ACCOUNT_ID,
      partnerAccount: partnerAccount(),
      partnerLabel: '411000 CLIENT X',
      totalAmount: '1000.00',
      status: 'complete',
      createdById: USER_ID,
      createdAt: new Date(),
      completedAt: new Date(),
      brokenAt: null,
      brokenReason: null,
      brokenById: null,
      organizationId: ORG_ID,
    } as unknown as PartnerLetteringEntity);

    const result = await h.service.create(
      ORG_ID,
      { journalEntryLineIds: ['inv-1', 'inv-2', 'inv-3', 'pay-1'] },
      USER_ID,
      CTX,
    );

    expect(result.totalAmount).toBe('1000.00');
    expect(h.lineRepo.attachLettering).toHaveBeenCalledWith(
      ['inv-1', 'inv-2', 'inv-3', 'pay-1'],
      'lettering-2',
      ORG_ID,
      expect.anything(),
    );
  });
});

describe('LetteringService.breakLettering', () => {
  it('detaches all lines and marks the lettering broken with a reason', async () => {
    const h = buildHarness();
    h.letteringRepo.findById.mockResolvedValue({
      id: 'lettering-1',
      status: 'complete',
      organizationId: ORG_ID,
    } as unknown as PartnerLetteringEntity);

    await h.service.breakLettering(ORG_ID, 'lettering-1', 'Erreur de saisie', USER_ID, CTX);

    expect(h.lineRepo.detachLettering).toHaveBeenCalledWith('lettering-1', ORG_ID, expect.anything());
    expect(h.letteringRepo.markBroken).toHaveBeenCalledWith(
      'lettering-1',
      ORG_ID,
      USER_ID,
      'Erreur de saisie',
      expect.anything(),
    );
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lettering_broken',
        before: { status: 'complete' },
        after: { status: 'broken', reason: 'Erreur de saisie' },
      }),
    );
  });

  it('returns 404 LETTERING_NOT_FOUND when the id does not belong to this tenant', async () => {
    const h = buildHarness();
    h.letteringRepo.findById.mockResolvedValue(null);
    await expect(
      h.service.breakLettering(ORG_ID, 'unknown', 'X', USER_ID, CTX),
    ).rejects.toMatchObject({ code: 'LETTERING_NOT_FOUND' });
    expect(h.lineRepo.detachLettering).not.toHaveBeenCalled();
  });

  it('refuses LETTERING_ALREADY_BROKEN on a re-break attempt', async () => {
    const h = buildHarness();
    h.letteringRepo.findById.mockResolvedValue({
      id: 'lettering-1',
      status: 'broken',
      organizationId: ORG_ID,
    } as unknown as PartnerLetteringEntity);

    await expect(
      h.service.breakLettering(ORG_ID, 'lettering-1', 'X', USER_ID, CTX),
    ).rejects.toMatchObject({ code: 'LETTERING_ALREADY_BROKEN' });
    expect(h.lineRepo.detachLettering).not.toHaveBeenCalled();
  });
});

describe('PartnerLetteringRepository.incrementCode (static helper)', () => {
  // Imported indirectly via the service; we exercise it via the
  // repository's static directly to lock the wraparound semantics.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PartnerLetteringRepository } = require('../repositories/partner-lettering.repository') as {
    PartnerLetteringRepository: { incrementCode: (s: string) => string };
  };

  it.each([
    ['A0001', 'A0002'],
    ['A9998', 'A9999'],
    ['A9999', 'B0001'],
    ['Z9999', 'A0001'],
    ['garbage', 'A0001'],
  ])('%s → %s', (input, expected) => {
    expect(PartnerLetteringRepository.incrementCode(input)).toBe(expected);
  });
});
