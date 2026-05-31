import type { DataSource } from 'typeorm';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AuditTrailService } from '../../audit/services/audit-trail.service';
import type { JournalEntryLineEntity } from '../entities/journal-entry-line.entity';
import type { PartnerLetteringEntity } from '../entities/partner-lettering.entity';
import type { JournalEntryLineRepository } from '../repositories/journal-entry-line.repository';
import { PartnerLetteringRepository } from '../repositories/partner-lettering.repository';
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
    listUnletteredPartnerLinesWithInvoice: jest.Mock;
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
    listUnletteredPartnerLinesWithInvoice: jest.fn().mockResolvedValue([]),
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

  it('creates a balanced lettering on a class-43 organismes-sociaux account (4381 URSSAF)', async () => {
    const h = buildHarness();
    const urssaf = { id: ACCOUNT_ID, code: '438100', label: 'URSSAF charges à payer', class: 4 };
    h.lineRepo.listForLetteringCheck.mockResolvedValue([
      {
        line: buildLine('line-1', { account: urssaf as never, debit: '500.00', credit: '0' }),
        entryStatus: 'validated',
      },
      {
        line: buildLine('line-2', { account: urssaf as never, debit: '0', credit: '500.00' }),
        entryStatus: 'validated',
      },
    ]);
    h.letteringRepo.create.mockResolvedValue({
      id: 'lettering-43',
      letteringCode: 'A0001',
      partnerAccountId: ACCOUNT_ID,
      partnerAccount: urssaf,
      partnerLabel: '438100 URSSAF charges à payer',
      totalAmount: '500.00',
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

    expect(result.totalAmount).toBe('500.00');
    expect(result.status).toBe('complete');
    expect(h.lineRepo.attachLettering).toHaveBeenCalled();
  });

  it('creates a balanced lettering on a class-44 État account (4441 TVA due)', async () => {
    const h = buildHarness();
    const tva = { id: ACCOUNT_ID, code: '444100', label: 'TVA due', class: 4 };
    h.lineRepo.listForLetteringCheck.mockResolvedValue([
      {
        line: buildLine('line-1', { account: tva as never, debit: '1200.00', credit: '0' }),
        entryStatus: 'validated',
      },
      {
        line: buildLine('line-2', { account: tva as never, debit: '0', credit: '1200.00' }),
        entryStatus: 'validated',
      },
    ]);
    h.letteringRepo.create.mockResolvedValue({
      id: 'lettering-44',
      letteringCode: 'A0001',
      partnerAccountId: ACCOUNT_ID,
      partnerAccount: tva,
      partnerLabel: '444100 TVA due',
      totalAmount: '1200.00',
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

    expect(result.totalAmount).toBe('1200.00');
    expect(result.status).toBe('complete');
    expect(h.lineRepo.attachLettering).toHaveBeenCalled();
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

    expect(h.lineRepo.detachLettering).toHaveBeenCalledWith(
      'lettering-1',
      ORG_ID,
      expect.anything(),
    );
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
  // Exercised directly via the static — the wraparound semantics
  // (A9999 → B0001, Z9999 → A0001) are too important to leave to
  // implicit coverage through the service path.

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

describe('LetteringService.autoLetterByInvoice', () => {
  const fakeView = (code: string, amount: string) =>
    ({ letteringCode: code, totalAmount: amount }) as never;

  it('letters balanced same-invoice groups, skips singletons and unbalanced groups', async () => {
    const h = buildHarness();
    h.lineRepo.listUnletteredPartnerLinesWithInvoice.mockResolvedValue([
      // Facture F1 — soldée (1000 débit / 1000 crédit) → lettrable
      buildLine('l1', { invoiceNumber: 'F1', debit: '1000.00', credit: '0' }),
      buildLine('l2', { invoiceNumber: 'F1', debit: '0', credit: '1000.00' }),
      // Facture F2 — une seule ligne → singleton, ignorée
      buildLine('l3', { invoiceNumber: 'F2', debit: '500.00', credit: '0' }),
      // Facture F3 — règlement partiel (300 vs 200) → déséquilibrée, ignorée
      buildLine('l4', { invoiceNumber: 'F3', debit: '300.00', credit: '0' }),
      buildLine('l5', { invoiceNumber: 'F3', debit: '0', credit: '200.00' }),
    ]);
    const createSpy = jest
      .spyOn(h.service, 'create')
      .mockResolvedValue(fakeView('A0001', '1000.00'));

    const result = await h.service.autoLetterByInvoice(ORG_ID, {}, USER_ID, CTX);

    expect(result.groupsConsidered).toBe(3);
    expect(result.letteringsCreated).toBe(1);
    expect(result.linesLettered).toBe(2);
    expect(result.skippedSingleton).toBe(1);
    expect(result.skippedUnbalanced).toBe(1);
    expect(result.skippedError).toBe(0);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(
      ORG_ID,
      { journalEntryLineIds: ['l1', 'l2'] },
      USER_ID,
      CTX,
    );
    expect(result.letterings).toEqual([
      expect.objectContaining({ letteringCode: 'A0001', invoiceNumber: 'F1', lineCount: 2 }),
    ]);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lettering_auto_by_invoice' }),
    );
  });

  it('creates a separate lettering per distinct invoice', async () => {
    const h = buildHarness();
    h.lineRepo.listUnletteredPartnerLinesWithInvoice.mockResolvedValue([
      buildLine('a1', { invoiceNumber: 'F1', debit: '100.00', credit: '0' }),
      buildLine('a2', { invoiceNumber: 'F1', debit: '0', credit: '100.00' }),
      buildLine('b1', { invoiceNumber: 'F2', debit: '200.00', credit: '0' }),
      buildLine('b2', { invoiceNumber: 'F2', debit: '0', credit: '200.00' }),
    ]);
    const createSpy = jest
      .spyOn(h.service, 'create')
      .mockResolvedValueOnce(fakeView('A0001', '100.00'))
      .mockResolvedValueOnce(fakeView('A0002', '200.00'));

    const result = await h.service.autoLetterByInvoice(ORG_ID, {}, USER_ID, CTX);

    expect(result.letteringsCreated).toBe(2);
    expect(result.linesLettered).toBe(4);
    expect(createSpy).toHaveBeenCalledTimes(2);
  });

  it('counts a per-group failure as skippedError without aborting the batch', async () => {
    const h = buildHarness();
    h.lineRepo.listUnletteredPartnerLinesWithInvoice.mockResolvedValue([
      buildLine('a1', { invoiceNumber: 'F1', debit: '100.00', credit: '0' }),
      buildLine('a2', { invoiceNumber: 'F1', debit: '0', credit: '100.00' }),
      buildLine('b1', { invoiceNumber: 'F2', debit: '200.00', credit: '0' }),
      buildLine('b2', { invoiceNumber: 'F2', debit: '0', credit: '200.00' }),
    ]);
    jest
      .spyOn(h.service, 'create')
      .mockRejectedValueOnce(new Error('LETTERING_LINE_ALREADY_USED (race)'))
      .mockResolvedValueOnce(fakeView('A0001', '200.00'));

    const result = await h.service.autoLetterByInvoice(ORG_ID, {}, USER_ID, CTX);

    expect(result.letteringsCreated).toBe(1);
    expect(result.skippedError).toBe(1);
    expect(result.linesLettered).toBe(2);
  });

  it('returns an empty summary when no candidate lines exist', async () => {
    const h = buildHarness();
    h.lineRepo.listUnletteredPartnerLinesWithInvoice.mockResolvedValue([]);

    const result = await h.service.autoLetterByInvoice(ORG_ID, {}, USER_ID, CTX);

    expect(result).toMatchObject({
      groupsConsidered: 0,
      letteringsCreated: 0,
      linesLettered: 0,
    });
  });
});

describe('LetteringService.previewAutoLetterByInvoice', () => {
  it('reports a balanced invoice group as a suggestion WITHOUT persisting anything (dry-run)', async () => {
    const h = buildHarness();
    h.lineRepo.listUnletteredPartnerLinesWithInvoice.mockResolvedValue([
      buildLine('l1', { invoiceNumber: 'FAC-001', debit: '1000.00', credit: '0' }),
      buildLine('l2', { invoiceNumber: 'FAC-001', debit: '0', credit: '1000.00' }),
    ]);

    const result = await h.service.previewAutoLetterByInvoice(ORG_ID, {});

    expect(result).toMatchObject({
      groupsConsidered: 1,
      wouldLetter: 1,
      wouldLetterLines: 2,
      skippedSingleton: 0,
      skippedUnbalanced: 0,
    });
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({
      invoiceNumber: 'FAC-001',
      partnerAccountId: ACCOUNT_ID,
      partnerAccountCode: '411000',
      partnerLabel: 'CLIENT X',
      lineCount: 2,
      totalAmount: '1000.00',
    });
    // Dry-run invariant: no write path is ever touched.
    expect(h.letteringRepo.create).not.toHaveBeenCalled();
    expect(h.lineRepo.attachLettering).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it('skips an invoice that has a single line (skippedSingleton, no suggestion)', async () => {
    const h = buildHarness();
    h.lineRepo.listUnletteredPartnerLinesWithInvoice.mockResolvedValue([
      buildLine('l1', { invoiceNumber: 'FAC-002', debit: '500.00', credit: '0' }),
    ]);

    const result = await h.service.previewAutoLetterByInvoice(ORG_ID, {});

    expect(result).toMatchObject({ wouldLetter: 0, skippedSingleton: 1, skippedUnbalanced: 0 });
    expect(result.suggestions).toHaveLength(0);
  });

  it('skips an unbalanced group — partial settlement (skippedUnbalanced, no suggestion)', async () => {
    const h = buildHarness();
    h.lineRepo.listUnletteredPartnerLinesWithInvoice.mockResolvedValue([
      buildLine('l1', { invoiceNumber: 'FAC-003', debit: '1000.00', credit: '0' }),
      buildLine('l2', { invoiceNumber: 'FAC-003', debit: '0', credit: '400.00' }),
    ]);

    const result = await h.service.previewAutoLetterByInvoice(ORG_ID, {});

    expect(result).toMatchObject({ wouldLetter: 0, skippedSingleton: 0, skippedUnbalanced: 1 });
    expect(result.suggestions).toHaveLength(0);
  });

  it('ignores lines without an invoice number (not counted as a group)', async () => {
    const h = buildHarness();
    h.lineRepo.listUnletteredPartnerLinesWithInvoice.mockResolvedValue([
      buildLine('l1', { invoiceNumber: null, debit: '100.00', credit: '0' }),
      buildLine('l2', { invoiceNumber: '   ', debit: '0', credit: '100.00' }),
    ]);

    const result = await h.service.previewAutoLetterByInvoice(ORG_ID, {});

    expect(result).toMatchObject({ groupsConsidered: 0, wouldLetter: 0 });
    expect(result.suggestions).toHaveLength(0);
  });

  it('forwards the partnerAccountId filter to the repository', async () => {
    const h = buildHarness();
    h.lineRepo.listUnletteredPartnerLinesWithInvoice.mockResolvedValue([]);

    await h.service.previewAutoLetterByInvoice(ORG_ID, { partnerAccountId: ACCOUNT_ID });

    expect(h.lineRepo.listUnletteredPartnerLinesWithInvoice).toHaveBeenCalledWith(ORG_ID, {
      partnerAccountId: ACCOUNT_ID,
    });
  });
});
