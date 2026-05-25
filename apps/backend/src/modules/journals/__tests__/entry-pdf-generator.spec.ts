import type { OrganizationAccountEntity } from '../../accounting-plan/entities/organization-account.entity';
import type { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { AccountingPeriodEntity } from '../entities/accounting-period.entity';
import type { EntrySignatureEntity } from '../entities/entry-signature.entity';
import type { JournalEntryLineEntity } from '../entities/journal-entry-line.entity';
import type { JournalEntryEntity } from '../entities/journal-entry.entity';
import type { JournalEntity } from '../entities/journal.entity';
import { EntryPdfGenerator, buildVerifyUrl } from '../services/entry-pdf-generator';

function makeEntry(): JournalEntryEntity {
  return {
    id: 'entry-1',
    organizationId: 'org-1',
    journalId: 'j-1',
    periodId: 'p-1',
    entryNumber: 42,
    entryDate: '2026-02-15',
    description: 'Achat fournitures bureau',
    reference: 'FAC-2026-001',
    status: 'validated',
    cancelsId: null,
    sourceType: 'manual',
    sourceImportSessionId: null,
    createdById: 'user-1',
    validatedAt: new Date('2026-02-16T09:00:00Z'),
    validatedById: 'user-2',
    cancelledAt: null,
    cancelledById: null,
    cancelledReason: null,
  } as JournalEntryEntity;
}

function makeLine(overrides: Partial<JournalEntryLineEntity>): JournalEntryLineEntity {
  return {
    id: 'l',
    organizationId: 'org-1',
    journalEntryId: 'entry-1',
    accountId: 'acc-1',
    position: 1,
    description: null,
    debit: '0',
    credit: '0',
    lineLetter: null,
    letteringId: null,
    createdAt: new Date(),
    ...overrides,
  } as JournalEntryLineEntity;
}

describe('EntryPdfGenerator', () => {
  it('produces a non-empty PDF buffer that starts with the PDF magic header', async () => {
    const gen = new EntryPdfGenerator();
    const lines: JournalEntryLineEntity[] = [
      makeLine({ id: 'l1', accountId: 'acc-1', position: 1, debit: '100.00', credit: '0' }),
      makeLine({ id: 'l2', accountId: 'acc-2', position: 2, debit: '0', credit: '100.00' }),
    ];
    const accountsById = new Map<
      string,
      Pick<OrganizationAccountEntity, 'id' | 'code' | 'label'>
    >([
      ['acc-1', { id: 'acc-1', code: '606300', label: 'Fournitures de bureau' }],
      ['acc-2', { id: 'acc-2', code: '401000', label: 'Fournisseurs' }],
    ]);
    const signatures: EntrySignatureEntity[] = [
      {
        id: 'sig-1',
        organizationId: 'org-1',
        journalEntryId: 'entry-1',
        signerId: 'u-cm',
        signerRole: 'chef_mission',
        signatureHash: 'a'.repeat(64),
        comment: null,
        signedAt: new Date('2026-02-16T08:00:00Z'),
      } as EntrySignatureEntity,
      {
        id: 'sig-2',
        organizationId: 'org-1',
        journalEntryId: 'entry-1',
        signerId: 'u-ec',
        signerRole: 'expert_comptable',
        signatureHash: 'b'.repeat(64),
        comment: null,
        signedAt: new Date('2026-02-16T09:00:00Z'),
      } as EntrySignatureEntity,
    ];

    const buf = await gen.generate({
      entry: makeEntry(),
      lines,
      accountsById,
      signatures,
      journal: { code: 'AC', label: 'Achats' } as JournalEntity,
      period: {
        label: 'Février 2026',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
      } as AccountingPeriodEntity,
      organization: { id: 'org-1', name: 'Acme SARL' } as OrganizationEntity,
      verificationSignatureId: 'sig-2',
    });

    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(500);
    // PDF magic: %PDF-
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    // pdfkit compresses text streams by default, but the entry number is
    // also stamped into the PDF metadata Title (`Écriture AC-42`),
    // which is NOT compressed. Searching the raw bytes is enough to
    // assert the generator received and rendered the data.
    const haystack = buf.toString('latin1');
    expect(haystack).toContain('42');
  });

  it('renders even when no signatures are present yet', async () => {
    const gen = new EntryPdfGenerator();
    const buf = await gen.generate({
      entry: makeEntry(),
      lines: [],
      accountsById: new Map(),
      signatures: [],
      journal: { code: 'AC', label: 'Achats' } as JournalEntity,
      period: {
        label: 'Février 2026',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
      } as AccountingPeriodEntity,
      organization: { id: 'org-1', name: 'Acme SARL' } as OrganizationEntity,
      verificationSignatureId: 'sig-x',
    });
    expect(buf.length).toBeGreaterThan(200);
  });
});

describe('buildVerifyUrl', () => {
  afterEach(() => {
    delete process.env.PUBLIC_VERIFY_URL;
  });

  it('falls back to the documented default when PUBLIC_VERIFY_URL is unset', () => {
    expect(buildVerifyUrl('abc')).toBe('https://erp.example.com/verify-signature/abc');
  });

  it('honours PUBLIC_VERIFY_URL override and strips trailing slashes', () => {
    process.env.PUBLIC_VERIFY_URL = 'https://my-erp.example/';
    expect(buildVerifyUrl('xyz')).toBe('https://my-erp.example/verify-signature/xyz');
  });
});
