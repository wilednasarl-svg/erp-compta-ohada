import { Readable } from 'stream';

import type { ConfigService } from '@nestjs/config';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AuditTrailService } from '../../audit/services/audit-trail.service';
import type { DocumentEntity } from '../entities/document.entity';
import type {
  DocumentListFilters,
  DocumentRepository,
  PaginationOptions,
} from '../repositories/document.repository';
import type { DocumentEntryRepository } from '../repositories/document-entry.repository';
import type { JournalEntryRepository } from '../../journals/repositories/journal-entry.repository';
import type { EntriesService } from '../../journals/services/entries.service';
import type { DocumentStorage, SaveDocumentResult } from './document-storage.interface';
import type { DocumentOcrService } from './document-ocr.service';
import { DocumentsService } from './documents.service';
import type { OcrProvider } from './ocr-provider';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB for tests
const ORG_A = asTenantId('org_a');
const ORG_B = asTenantId('org_b');

function buildConfigService(): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'documents') {
        return { storageDir: '/tmp/never-used', maxFileSizeBytes: MAX_BYTES };
      }
      return undefined;
    }),
  } as unknown as ConfigService;
}

function buildStorageStub(): jest.Mocked<DocumentStorage> {
  return {
    save: jest.fn(),
    getStream: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(false),
  };
}

function buildDocsRepoStub(): jest.Mocked<DocumentRepository> {
  return {
    findById: jest.fn(),
    findByIdIncludingDeleted: jest.fn(),
    findActiveBySha256: jest.fn().mockResolvedValue([]),
    createOne: jest.fn(),
    softDelete: jest.fn(),
    listForOrg: jest.fn(),
  } as unknown as jest.Mocked<DocumentRepository>;
}

function buildEntriesRepoStub(): jest.Mocked<DocumentEntryRepository> {
  return {
    link: jest.fn().mockResolvedValue(0),
    listForDocument: jest.fn(),
    listForEntry: jest.fn(),
    countForDocument: jest.fn(),
    countForDocuments: jest.fn().mockResolvedValue(new Map<string, number>()),
  } as unknown as jest.Mocked<DocumentEntryRepository>;
}

function buildOcrStub(): jest.Mocked<DocumentOcrService> {
  return {
    requestOcr: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<DocumentOcrService>;
}

function buildAuditStub(): jest.Mocked<AuditTrailService> {
  return {
    record: jest.fn().mockResolvedValue(null),
  } as unknown as jest.Mocked<AuditTrailService>;
}

function buildOcrProviderStub(): jest.Mocked<OcrProvider> {
  return {
    extract: jest.fn().mockResolvedValue(null),
  } as unknown as jest.Mocked<OcrProvider>;
}

function buildJournalEntriesRepoStub(): jest.Mocked<JournalEntryRepository> {
  return {
    findById: jest.fn(),
    create: jest.fn(),
    listForOrg: jest.fn(),
  } as unknown as jest.Mocked<JournalEntryRepository>;
}

function buildDocumentRow(overrides: Partial<DocumentEntity> = {}): DocumentEntity {
  const now = new Date('2026-05-24T12:00:00.000Z');
  return {
    id: 'doc_1',
    organizationId: 'org_a',
    filename: 'invoice.pdf',
    mimeType: 'application/pdf',
    sizeBytes: '1234',
    sha256Checksum: 'a'.repeat(64),
    storageKey: 'org_a/2026/05/aaa.pdf',
    tags: ['vente'],
    description: null,
    ocrStatus: 'pending',
    ocrText: null,
    ocrConfidence: null,
    ocrProcessedAt: null,
    extractedMetadata: null,
    uploadedBy: 'user_1',
    uploadedAt: now,
    deletedAt: null,
    deletedBy: null,
    createdAt: now,
    updatedAt: now,
    entryLinks: [],
    organization: {} as DocumentEntity['organization'],
    uploader: {} as DocumentEntity['uploader'],
    ...overrides,
  } as DocumentEntity;
}

describe('DocumentsService (BE-DOC-04)', () => {
  let docs: jest.Mocked<DocumentRepository>;
  let entries: jest.Mocked<DocumentEntryRepository>;
  let ocr: jest.Mocked<DocumentOcrService>;
  let storage: jest.Mocked<DocumentStorage>;
  let audit: jest.Mocked<AuditTrailService>;
  let ocrProvider: jest.Mocked<OcrProvider>;
  let journalEntries: jest.Mocked<JournalEntryRepository>;
  let entriesService: jest.Mocked<EntriesService>;
  let service: DocumentsService;

  beforeEach(() => {
    docs = buildDocsRepoStub();
    // Module 10 wave 2 added `updateOcrResult` — stub it so the
    // fire-and-forget OCR pipeline does not blow up in tests.
    (docs as unknown as { updateOcrResult: jest.Mock }).updateOcrResult = jest
      .fn()
      .mockResolvedValue(true);
    entries = buildEntriesRepoStub();
    ocr = buildOcrStub();
    storage = buildStorageStub();
    audit = buildAuditStub();
    ocrProvider = buildOcrProviderStub();
    journalEntries = buildJournalEntriesRepoStub();
    entriesService = { createDraft: jest.fn() } as unknown as jest.Mocked<EntriesService>;
    service = new DocumentsService(
      docs,
      entries,
      ocr,
      storage,
      audit,
      buildConfigService(),
      ocrProvider,
      journalEntries,
      entriesService,
    );
  });

  describe('createFromUpload', () => {
    const file = {
      originalName: 'invoice.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1234,
      body: Buffer.from('fake-pdf-bytes'),
    };

    it('persists bytes via storage, creates the row, and triggers OCR', async () => {
      const saveResult: SaveDocumentResult = {
        storageKey: 'org_a/2026/05/sha.pdf',
        sha256Checksum: 'b'.repeat(64),
        sizeBytes: 1234,
      };
      storage.save.mockResolvedValue(saveResult);
      const row = buildDocumentRow({ storageKey: saveResult.storageKey });
      docs.createOne.mockResolvedValue(row);

      const view = await service.createFromUpload(ORG_A, 'user_1', file, {
        tags: ['vente', 'client-x'],
      });

      expect(storage.save).toHaveBeenCalledWith({
        organizationId: 'org_a',
        originalName: 'invoice.pdf',
        mimeType: 'application/pdf',
        body: file.body,
      });
      expect(docs.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org_a',
          filename: 'invoice.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1234,
          sha256Checksum: 'b'.repeat(64),
          storageKey: 'org_a/2026/05/sha.pdf',
          tags: ['vente', 'client-x'],
          uploadedBy: 'user_1',
        }),
      );
      expect(ocr.requestOcr).toHaveBeenCalledWith(row.id, 'org_a');
      expect(view.id).toBe(row.id);
      expect(view.downloadUrl).toBe(`/documents/${row.id}/content`);

      // BE-DOC-09 — Module 7 audit: a single `documents.uploaded` row
      // with the immutable facts in `after`, scoped to org+actor.
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'documents',
          action: 'uploaded',
          entityType: 'document',
          entityId: row.id,
          after: expect.objectContaining({
            filename: 'invoice.pdf',
            mimeType: 'application/pdf',
            sha256Checksum: 'a'.repeat(64),
          }),
          metadata: expect.objectContaining({ linkedEntryCount: 0 }),
          ctx: expect.objectContaining({ userId: 'user_1', organizationId: 'org_a' }),
          legacyEventType: 'documents.uploaded',
        }),
      );
    });

    it('rejects when no file is provided (DOC_FILE_REQUIRED)', async () => {
      await expect(service.createFromUpload(ORG_A, 'user_1', undefined)).rejects.toMatchObject({
        code: ERROR_CODES.DOC_FILE_REQUIRED,
      });
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('rejects an oversized file before touching storage (DOC_FILE_TOO_LARGE)', async () => {
      await expect(
        service.createFromUpload(ORG_A, 'user_1', { ...file, sizeBytes: MAX_BYTES + 1 }),
      ).rejects.toMatchObject({ code: ERROR_CODES.DOC_FILE_TOO_LARGE });
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('rejects an unsupported MIME type', async () => {
      await expect(
        service.createFromUpload(ORG_A, 'user_1', {
          ...file,
          mimeType: 'application/x-executable',
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.DOC_MIME_REJECTED });
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('rolls back persisted bytes when the row insert fails', async () => {
      storage.save.mockResolvedValue({
        storageKey: 'org_a/2026/05/sha.pdf',
        sha256Checksum: 'c'.repeat(64),
        sizeBytes: 1234,
      });
      const dbError = new Error('insert failed');
      docs.createOne.mockRejectedValue(dbError);

      await expect(service.createFromUpload(ORG_A, 'user_1', file)).rejects.toBe(dbError);

      expect(storage.delete).toHaveBeenCalledWith('org_a/2026/05/sha.pdf');
      expect(ocr.requestOcr).not.toHaveBeenCalled();
    });

    it('links journal entries when linkedEntryIds is provided', async () => {
      storage.save.mockResolvedValue({
        storageKey: 'org_a/2026/05/sha.pdf',
        sha256Checksum: 'd'.repeat(64),
        sizeBytes: 100,
      });
      const row = buildDocumentRow();
      docs.createOne.mockResolvedValue(row);

      await service.createFromUpload(ORG_A, 'user_1', file, {
        linkedEntryIds: ['entry_1', 'entry_2'],
      });

      expect(entries.link).toHaveBeenCalledWith({
        organizationId: 'org_a',
        documentId: row.id,
        entryIds: ['entry_1', 'entry_2'],
        createdBy: 'user_1',
      });

      // BE-DOC-09 — two audit rows on a linked upload: `uploaded` +
      // `linked_entry` (the second carries the entry id list for
      // forensic reconstruction).
      const actions = audit.record.mock.calls.map((c) => c[0].action);
      expect(actions).toEqual(expect.arrayContaining(['uploaded', 'linked_entry']));
      const linked = audit.record.mock.calls.find((c) => c[0].action === 'linked_entry');
      expect(linked?.[0]).toMatchObject({
        module: 'documents',
        entityType: 'document',
        entityId: row.id,
        after: { entryIds: ['entry_1', 'entry_2'] },
        metadata: { entryCount: 2 },
      });
    });

    it('drops duplicate / blank tags and caps at 32', async () => {
      storage.save.mockResolvedValue({
        storageKey: 'org_a/2026/05/sha.pdf',
        sha256Checksum: 'e'.repeat(64),
        sizeBytes: 12,
      });
      docs.createOne.mockResolvedValue(buildDocumentRow());

      const noisy = [
        '  vente  ',
        'vente',
        '',
        '   ',
        'client-x',
        ...Array.from({ length: 40 }, (_, i) => `tag-${i}`),
      ];
      await service.createFromUpload(ORG_A, 'user_1', file, { tags: noisy });

      const passed = docs.createOne.mock.calls[0][0].tags as string[];
      expect(passed.length).toBe(32);
      expect(passed[0]).toBe('vente');
      expect(passed).toContain('client-x');
      expect(new Set(passed).size).toBe(passed.length);
    });
  });

  describe('getForOrg', () => {
    it('returns the view when the document exists in the tenant', async () => {
      docs.findById.mockResolvedValue(buildDocumentRow());
      const view = await service.getForOrg(ORG_A, 'doc_1');
      expect(view.id).toBe('doc_1');
      expect(view.organizationId).toBe('org_a');
    });

    it('throws DOC_NOT_FOUND when the document is missing (cross-tenant or absent)', async () => {
      docs.findById.mockResolvedValue(null);
      await expect(service.getForOrg(ORG_B, 'doc_1')).rejects.toMatchObject({
        code: ERROR_CODES.DOC_NOT_FOUND,
      });
      expect(docs.findById).toHaveBeenCalledWith('org_b', 'doc_1');
    });
  });

  describe('openStreamForOrg', () => {
    it('returns the storage stream + metadata for a tenant document', async () => {
      const row = buildDocumentRow();
      docs.findById.mockResolvedValue(row);
      const stream = Readable.from(['hello']);
      storage.getStream.mockResolvedValue(stream);

      const result = await service.openStreamForOrg(ORG_A, 'doc_1');
      expect(result.filename).toBe('invoice.pdf');
      expect(result.mimeType).toBe('application/pdf');
      expect(result.sizeBytes).toBe(1234);
      expect(storage.getStream).toHaveBeenCalledWith(row.storageKey);
    });

    it('throws DOC_NOT_FOUND when the row is missing', async () => {
      docs.findById.mockResolvedValue(null);
      await expect(service.openStreamForOrg(ORG_A, 'doc_1')).rejects.toMatchObject({
        code: ERROR_CODES.DOC_NOT_FOUND,
      });
      expect(storage.getStream).not.toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('soft-deletes the row, leaves storage untouched, emits a soft_deleted audit row', async () => {
      const row = buildDocumentRow();
      docs.findById.mockResolvedValue(row);
      docs.softDelete.mockResolvedValue(true);

      await service.softDelete(ORG_A, 'doc_1', 'user_1');

      expect(docs.softDelete).toHaveBeenCalledWith('org_a', 'doc_1', 'user_1');
      expect(storage.delete).not.toHaveBeenCalled();

      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'documents',
          action: 'soft_deleted',
          entityType: 'document',
          entityId: 'doc_1',
          before: expect.objectContaining({
            filename: 'invoice.pdf',
            sizeBytes: 1234,
          }),
          after: null,
          ctx: expect.objectContaining({ userId: 'user_1', organizationId: 'org_a' }),
          legacyEventType: 'documents.deleted',
        }),
      );
    });

    it('throws DOC_NOT_FOUND when the document is missing — and does NOT emit an audit row', async () => {
      docs.findById.mockResolvedValue(null);
      await expect(service.softDelete(ORG_A, 'doc_x', 'user_1')).rejects.toMatchObject({
        code: ERROR_CODES.DOC_NOT_FOUND,
      });
      expect(docs.softDelete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('listForOrg', () => {
    it('forwards filters and pagination, maps rows to views', async () => {
      docs.listForOrg.mockResolvedValue({
        rows: [buildDocumentRow({ id: 'd1' }), buildDocumentRow({ id: 'd2' })],
        total: 27,
      });

      const filters: DocumentListFilters = { tag: 'vente' };
      const pagination: PaginationOptions = { page: 2, pageSize: 10 };
      const result = await service.listForOrg(ORG_A, filters, pagination);

      expect(docs.listForOrg).toHaveBeenCalledWith('org_a', filters, pagination);
      expect(result.total).toBe(27);
      expect(result.rows.map((r) => r.id)).toEqual(['d1', 'd2']);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
    });

    it('enriches each view with its linked-entry count (0 when absent from the map)', async () => {
      docs.listForOrg.mockResolvedValue({
        rows: [buildDocumentRow({ id: 'd1' }), buildDocumentRow({ id: 'd2' })],
        total: 2,
      });
      // d1 is attached to 3 écritures; d2 is unlinked (absent from the map).
      entries.countForDocuments.mockResolvedValue(new Map<string, number>([['d1', 3]]));

      const result = await service.listForOrg(ORG_A, {}, { page: 1, pageSize: 10 });

      expect(entries.countForDocuments).toHaveBeenCalledWith('org_a', ['d1', 'd2']);
      const byId = new Map(result.rows.map((r) => [r.id, r.linkedEntryCount]));
      expect(byId.get('d1')).toBe(3);
      expect(byId.get('d2')).toBe(0);
    });
  });

  describe('tenant isolation (multi-tenant invariant)', () => {
    it('passes the explicit organizationId to every repository call', async () => {
      storage.save.mockResolvedValue({
        storageKey: 'org_b/2026/05/sha.pdf',
        sha256Checksum: 'f'.repeat(64),
        sizeBytes: 10,
      });
      docs.createOne.mockResolvedValue(buildDocumentRow({ organizationId: 'org_b' }));

      await service.createFromUpload(ORG_B, 'user_42', {
        originalName: 't.txt',
        mimeType: 'text/plain',
        sizeBytes: 10,
        body: Buffer.from('hello'),
      });

      expect(storage.save.mock.calls[0][0].organizationId).toBe('org_b');
      expect(docs.findActiveBySha256).toHaveBeenCalledWith('org_b', 'f'.repeat(64));
      expect(docs.createOne.mock.calls[0][0].organizationId).toBe('org_b');
    });
  });

  describe('OCR pipeline (Module 10 wave 2)', () => {
    const file = {
      originalName: 'invoice.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1234,
      body: Buffer.from('fake-pdf-bytes'),
    };

    beforeEach(() => {
      storage.save.mockResolvedValue({
        storageKey: 'org_a/2026/05/sha.pdf',
        sha256Checksum: 'a'.repeat(64),
        sizeBytes: 1234,
      });
      docs.createOne.mockResolvedValue(buildDocumentRow());
      storage.getStream.mockResolvedValue(Readable.from([Buffer.from('image-bytes')]));
    });

    // Helper: poll the mock until it has been called (or the deadline
    // elapses). The OCR pipeline is fire-and-forget and involves a
    // stream-to-tempfile + fs.writeFile chain, so a couple of
    // `setImmediate` ticks aren't enough on slower runners.
    async function waitForCall(mock: jest.Mock, deadlineMs = 2000): Promise<void> {
      const start = Date.now();
      while (mock.mock.calls.length === 0 && Date.now() - start < deadlineMs) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    it('invokes the OCR provider after a successful upload', async () => {
      ocrProvider.extract.mockResolvedValue({ text: 'Facture N° FAC-2026-001', confidence: 0.87 });

      await service.createFromUpload(ORG_A, 'user_1', file);
      await waitForCall(ocrProvider.extract as unknown as jest.Mock);

      expect(ocrProvider.extract).toHaveBeenCalledTimes(1);
      const [, mimeType] = ocrProvider.extract.mock.calls[0];
      expect(mimeType).toBe('application/pdf');
    });

    it('swallows OCR failure without bricking the upload', async () => {
      ocrProvider.extract.mockRejectedValue(new Error('tesseract boom'));

      const view = await service.createFromUpload(ORG_A, 'user_1', file);
      await waitForCall(ocrProvider.extract as unknown as jest.Mock);

      expect(view.id).toBeDefined();
      expect(ocrProvider.extract).toHaveBeenCalled();
    });
  });

  describe('attachEntry (Module 10 wave 2)', () => {
    it('links a document to a journal entry in the same tenant', async () => {
      docs.findById.mockResolvedValue(buildDocumentRow());
      journalEntries.findById.mockResolvedValue({
        id: 'entry_1',
        organizationId: 'org_a',
      } as never);

      const result = await service.attachEntry(ORG_A, 'doc_1', 'entry_1', 'user_1');

      expect(result).toEqual({ documentId: 'doc_1', entryId: 'entry_1' });
      expect(entries.link).toHaveBeenCalledWith({
        organizationId: 'org_a',
        documentId: 'doc_1',
        entryIds: ['entry_1'],
        createdBy: 'user_1',
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'linked_entry', entityId: 'doc_1' }),
      );
    });

    it('throws DOC_NOT_FOUND when the document is missing or cross-tenant', async () => {
      docs.findById.mockResolvedValue(null);
      await expect(service.attachEntry(ORG_A, 'doc_x', 'entry_1', 'user_1')).rejects.toMatchObject({
        code: ERROR_CODES.DOC_NOT_FOUND,
      });
      expect(journalEntries.findById).not.toHaveBeenCalled();
      expect(entries.link).not.toHaveBeenCalled();
    });

    it('throws JOURNAL_ENTRY_NOT_FOUND when the entry is missing or cross-tenant', async () => {
      docs.findById.mockResolvedValue(buildDocumentRow());
      journalEntries.findById.mockResolvedValue(null);
      await expect(service.attachEntry(ORG_A, 'doc_1', 'entry_x', 'user_1')).rejects.toMatchObject({
        code: ERROR_CODES.JOURNAL_ENTRY_NOT_FOUND,
      });
      expect(entries.link).not.toHaveBeenCalled();
    });
  });

  it('AppException error code names are valid (sanity)', () => {
    // Ensures the spec compiled against a registered code (catches a
    // typo if someone renames `DOC_FILE_REQUIRED` in error-codes.ts).
    expect(new AppException(ERROR_CODES.DOC_FILE_REQUIRED).code).toBe('DOC_FILE_REQUIRED');
  });
});
