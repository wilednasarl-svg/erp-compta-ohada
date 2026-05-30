import { Readable } from 'node:stream';

import { ERROR_CODES } from '../../../common/errors/error-codes';
import { AppException } from '../../../common/errors/app-exception';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { ImportSessionEntity } from '../entities/import-session.entity';
import { ImportSessionService } from './import-session.service';
import { MappingService } from './mapping.service';
import { ValidationService } from './validation.service';

/**
 * Targeted unit tests around the business rules of
 * `ImportSessionService` — status guards, audit emission, tenant
 * propagation, file size enforcement. The disk-write path
 * (`persistFileToDisk`) is exercised through the public surface with
 * an in-memory destination provided via `tmpdir()` for a couple of
 * smoke cases; deeper file I/O coverage lives in the e2e suite.
 */
describe('ImportSessionService', () => {
  const ORG_ID = '00000000-0000-4000-8000-000000000001';
  const USER_ID = '00000000-0000-4000-8000-000000000002';
  const SESSION_ID = '00000000-0000-4000-8000-000000000003';
  const FILE_ID = '00000000-0000-4000-8000-000000000004';

  function buildService(overrides: Partial<Record<string, unknown>> = {}) {
    const sessionsRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      listByOrganization: jest.fn().mockResolvedValue([]),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      updateCounters: jest.fn().mockResolvedValue(undefined),
      updateMappingOverride: jest.fn().mockResolvedValue(undefined),
      updateLabel: jest.fn().mockResolvedValue(undefined),
      deleteById: jest.fn().mockResolvedValue(1),
    };
    const filesRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      listBySession: jest.fn().mockResolvedValue([]),
      findByChecksumInSession: jest.fn().mockResolvedValue(null),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      updateDetectedHeaders: jest.fn().mockResolvedValue(undefined),
    };
    const stagingRepo = {
      bulkInsert: jest.fn().mockResolvedValue(undefined),
      listBySession: jest.fn().mockResolvedValue([]),
      countBySession: jest.fn().mockResolvedValue({ total: 0, withErrors: 0 }),
      deleteBySession: jest.fn().mockResolvedValue(undefined),
      updateMappedValuesAndErrors: jest.fn().mockResolvedValue(undefined),
    };
    const parserService = {
      resolve: jest.fn().mockReturnValue({ id: 'csv' }),
      parse: jest.fn(),
    };
    const chartRepo = {
      listByOrganization: jest.fn().mockResolvedValue([]),
      findByCode: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation((input: { code: string }) =>
          Promise.resolve({ id: `org-acc-${input.code}`, ...input }),
        ),
    };
    const referenceRepo = {
      listBySystem: jest.fn().mockResolvedValue([]),
      findByCode: jest.fn().mockResolvedValue(null),
    };
    const audit = {
      record: jest.fn().mockResolvedValue(null),
    };
    const entries = {
      createDraft: jest.fn().mockResolvedValue({ id: 'entry-1' }),
      validate: jest.fn().mockResolvedValue({ id: 'entry-1', status: 'validated' }),
    };
    const config = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'imports') {
          return { storageDir: '/tmp/erp-test-uploads', maxFileSizeBytes: 1024 * 1024 };
        }
        return undefined;
      }),
    };

    const service = new ImportSessionService(
      sessionsRepo as never,
      filesRepo as never,
      stagingRepo as never,
      parserService as never,
      new MappingService(),
      new ValidationService(),
      chartRepo as never,
      entries as never,
      audit as never,
      config as never,
      referenceRepo as never,
    );

    return {
      service,
      sessionsRepo,
      filesRepo,
      stagingRepo,
      parserService,
      chartRepo,
      referenceRepo,
      entries,
      audit,
      config,
      ...overrides,
    };
  }

  function fakeSession(overrides: Partial<ImportSessionEntity> = {}): ImportSessionEntity {
    return {
      id: SESSION_ID,
      organizationId: ORG_ID,
      companyId: null,
      fiscalYear: null,
      label: null,
      sourceType: 'csv',
      status: 'draft',
      totalLines: 0,
      errorLines: 0,
      mappingOverride: null,
      failureReason: null,
      createdById: USER_ID,
      createdAt: new Date('2024-03-15T00:00:00Z'),
      updatedAt: new Date('2024-03-15T00:00:00Z'),
      organization: undefined as never,
      createdBy: undefined as never,
      files: [],
      stagingEntries: [],
      ...overrides,
    };
  }

  describe('createSession', () => {
    it('creates a draft session and emits an audit event', async () => {
      const { service, sessionsRepo, audit } = buildService();
      sessionsRepo.create.mockResolvedValue(fakeSession({ label: 'mars 2024' }));

      const result = await service.createSession(
        asTenantId(ORG_ID),
        { sourceType: 'csv', label: 'mars 2024' },
        USER_ID,
        { ipAddress: '127.0.0.1', userAgent: 'test' },
      );

      expect(result.status).toBe('draft');
      expect(sessionsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          sourceType: 'csv',
          label: 'mars 2024',
          createdById: USER_ID,
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'imports',
          action: 'session_created',
          legacyEventType: 'imports.session_created',
        }),
      );
    });
  });

  describe('getSession', () => {
    it('throws IMPORT_SESSION_NOT_FOUND when the session is absent', async () => {
      const { service, sessionsRepo } = buildService();
      sessionsRepo.findById.mockResolvedValue(null);

      await expect(service.getSession(asTenantId(ORG_ID), SESSION_ID)).rejects.toMatchObject({
        code: ERROR_CODES.IMPORT_SESSION_NOT_FOUND,
      });
    });
  });

  describe('uploadFile', () => {
    it('rejects upload when the session is not in draft status', async () => {
      const { service, sessionsRepo } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeSession({ status: 'parsed' }));

      await expect(
        service.uploadFile(
          asTenantId(ORG_ID),
          SESSION_ID,
          {
            originalName: 'data.csv',
            mimeType: 'text/csv',
            sizeBytes: 100,
            content: Readable.from(Buffer.from('compte;debit\n4111;100')),
          },
          USER_ID,
          { ipAddress: null, userAgent: null },
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.IMPORT_SESSION_NOT_DRAFT });
    });

    it('rejects upload when reported size exceeds the configured limit', async () => {
      const { service, sessionsRepo } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeSession());

      await expect(
        service.uploadFile(
          asTenantId(ORG_ID),
          SESSION_ID,
          {
            originalName: 'big.csv',
            mimeType: 'text/csv',
            sizeBytes: 5 * 1024 * 1024,
            content: Readable.from(Buffer.alloc(100)),
          },
          USER_ID,
          { ipAddress: null, userAgent: null },
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.IMPORT_FILE_TOO_LARGE });
    });

    it('rejects unsupported formats before any disk write', async () => {
      const { service, sessionsRepo, parserService } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeSession());
      parserService.resolve.mockImplementation(() => {
        throw new AppException(ERROR_CODES.IMPORT_UNSUPPORTED_FORMAT);
      });

      await expect(
        service.uploadFile(
          asTenantId(ORG_ID),
          SESSION_ID,
          {
            originalName: 'photo.png',
            mimeType: 'image/png',
            sizeBytes: 100,
            content: Readable.from(Buffer.from('not a csv')),
          },
          USER_ID,
          { ipAddress: null, userAgent: null },
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.IMPORT_UNSUPPORTED_FORMAT });
    });
  });

  describe('parseFile', () => {
    it('marks session/file as failed and re-throws when the parser blows up', async () => {
      const { service, sessionsRepo, filesRepo, parserService, audit } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeSession());
      filesRepo.findById.mockResolvedValue({
        id: FILE_ID,
        sessionId: SESSION_ID,
        originalName: 'data.csv',
        mimeType: 'text/csv',
        storagePath: `${ORG_ID}/${SESSION_ID}/123-data.csv`,
        status: 'uploaded',
      });
      parserService.parse.mockRejectedValue(new Error('boom'));

      await expect(
        service.parseFile(asTenantId(ORG_ID), SESSION_ID, FILE_ID, USER_ID, {
          ipAddress: null,
          userAgent: null,
        }),
      ).rejects.toThrow('boom');

      // Sanitized message: 'boom' has no path, so it passes through unchanged.
      expect(filesRepo.updateStatus).toHaveBeenCalledWith(FILE_ID, ORG_ID, 'parse_failed', 'boom');
      expect(sessionsRepo.markFailed).toHaveBeenCalledWith(SESSION_ID, ORG_ID, 'boom');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'session_failed',
          legacyEventType: 'imports.session_failed',
        }),
      );
    });

    it('persists staging rows, marks the file parsed and emits an audit event on success', async () => {
      const { service, sessionsRepo, filesRepo, parserService, stagingRepo, audit } =
        buildService();
      sessionsRepo.findById.mockResolvedValue(fakeSession());
      filesRepo.findById.mockResolvedValue({
        id: FILE_ID,
        sessionId: SESSION_ID,
        originalName: 'data.csv',
        mimeType: 'text/csv',
        storagePath: `${ORG_ID}/${SESSION_ID}/123-data.csv`,
        status: 'uploaded',
      });

      const rows = [
        { rowNumber: 1, values: { compte: '4111', debit: '100' } },
        { rowNumber: 2, values: { compte: '4112', debit: '50' } },
      ];
      parserService.parse.mockResolvedValue({
        parser: { id: 'csv' },
        result: {
          headers: ['compte', 'debit'],
          // eslint-disable-next-line @typescript-eslint/require-await
          rows: (async function* () {
            for (const r of rows) yield r;
          })(),
        },
      });

      const out = await service.parseFile(asTenantId(ORG_ID), SESSION_ID, FILE_ID, USER_ID, {
        ipAddress: null,
        userAgent: null,
      });

      expect(out).toEqual({ rowsParsed: 2, headers: ['compte', 'debit'] });
      expect(stagingRepo.bulkInsert).toHaveBeenCalled();
      expect(filesRepo.updateStatus).toHaveBeenLastCalledWith(FILE_ID, ORG_ID, 'parsed');
      expect(sessionsRepo.updateStatus).toHaveBeenLastCalledWith(SESSION_ID, ORG_ID, 'parsed');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'file_parsed',
          legacyEventType: 'imports.file_parsed',
        }),
      );
    });
  });

  // ─── sanitizeErrorMessage ──────────────────────────────────────────

  describe('detectSuggestedDocumentType (static)', () => {
    it('suggests trial_balance when only account + amounts are mapped (no date / journal / label)', () => {
      const suggestion = ImportSessionService.detectSuggestedDocumentType({
        compte: 'account',
        debit: 'debit',
        credit: 'credit',
      });
      expect(suggestion).toBe('trial_balance');
    });

    it('returns null when journal AND date are present (looks like entries)', () => {
      const suggestion = ImportSessionService.detectSuggestedDocumentType({
        compte: 'account',
        journal: 'journal',
        date: 'date',
        debit: 'debit',
        credit: 'credit',
        libelle: 'label',
      });
      expect(suggestion).toBeNull();
    });

    it('returns null when date is present even if journal is missing', () => {
      const suggestion = ImportSessionService.detectSuggestedDocumentType({
        compte: 'account',
        date: 'date',
        debit: 'debit',
        credit: 'credit',
      });
      // Has date → looks like general_ledger, not trial_balance — we
      // stay conservative and do not suggest.
      expect(suggestion).toBeNull();
    });
  });

  describe('sanitizeErrorMessage (static)', () => {
    it('strips POSIX absolute paths', () => {
      const raw = 'Cannot open file /var/uploads/org-1/sess-2/20240101-data.csv: ENOENT';
      expect(ImportSessionService.sanitizeErrorMessage(raw)).not.toContain('/var/uploads');
    });

    it('strips Windows absolute paths (drive letter)', () => {
      const raw = 'Failed to read C:\\Users\\erp\\uploads\\data.csv';
      expect(ImportSessionService.sanitizeErrorMessage(raw)).not.toContain('C:\\');
    });

    it('preserves innocuous messages unchanged', () => {
      const msg = 'Row 42: debit must be a number';
      expect(ImportSessionService.sanitizeErrorMessage(msg)).toBe(msg);
    });

    it('falls back to "Parsing error" for empty/blank inputs', () => {
      expect(ImportSessionService.sanitizeErrorMessage('')).toBe('Parsing error');
    });

    it('truncates very long messages to 500 chars', () => {
      const long = 'x'.repeat(600);
      expect(ImportSessionService.sanitizeErrorMessage(long)).toHaveLength(500);
    });
  });

  // ─── commitSession ────────────────────────────────────────────────

  describe('commitSession', () => {
    function fakeValidatedSession() {
      return {
        id: SESSION_ID,
        organizationId: ORG_ID,
        status: 'validated' as const,
        sourceType: 'csv' as const,
        label: null,
        totalLines: 10,
        errorLines: 0,
        createdAt: new Date(),
        stagingEntries: [],
        files: [],
        createdBy: null,
        createdById: USER_ID,
        company: null,
        companyId: null,
        fiscalYear: null,
        failureReason: null,
      };
    }

    function balancedRows(): Array<{
      rowNumber: number;
      mappedValues: Record<string, string | null>;
    }> {
      // 2 lines, same (journal, date), balanced 100 debit / 100 credit.
      return [
        {
          rowNumber: 1,
          mappedValues: {
            journal: 'VTE',
            date: '2026-01-15',
            account: '411000',
            label: 'Facture A',
            debit: '100',
            credit: '0',
          },
        },
        {
          rowNumber: 2,
          mappedValues: {
            journal: 'VTE',
            date: '2026-01-15',
            account: '707000',
            label: 'Facture A',
            debit: '0',
            credit: '100',
          },
        },
      ];
    }

    it('commits a clean validated session, creates a balanced entry and emits audit event', async () => {
      const { service, sessionsRepo, stagingRepo, entries, audit } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeValidatedSession());
      stagingRepo.countBySession.mockResolvedValue({ total: 2, withErrors: 0 });
      stagingRepo.listBySession.mockResolvedValue(balancedRows());
      entries.createDraft.mockResolvedValue({ id: 'entry-uuid-1' });

      const result = await service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
        ipAddress: null,
        userAgent: null,
      });

      expect(result.sessionId).toBe(SESSION_ID);
      expect(result.committedRows).toBe(2);
      expect(result.entryIds).toEqual(['entry-uuid-1']);

      // Pre-validation balance check passed → one createDraft + one validate per group.
      expect(entries.createDraft).toHaveBeenCalledTimes(1);
      const draftArg = entries.createDraft.mock.calls[0][1] as {
        journalCode: string;
        entryDate: string;
        sourceType: string;
        sourceImportSessionId: string;
        lines: Array<{ accountCode: string; debit: number; credit: number }>;
      };
      expect(draftArg.journalCode).toBe('VTE');
      expect(draftArg.entryDate).toBe('2026-01-15');
      expect(draftArg.sourceType).toBe('import');
      expect(draftArg.sourceImportSessionId).toBe(SESSION_ID);
      expect(draftArg.lines).toHaveLength(2);
      expect(entries.validate).toHaveBeenCalledWith(
        ORG_ID,
        'entry-uuid-1',
        USER_ID,
        expect.any(Object),
      );

      expect(sessionsRepo.updateStatus).toHaveBeenCalledWith(
        SESSION_ID,
        ORG_ID,
        'ready_for_import',
      );
      expect(sessionsRepo.updateStatus).toHaveBeenCalledWith(SESSION_ID, ORG_ID, 'completed');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'session_committed',
          legacyEventType: 'imports.session_committed',
          after: expect.objectContaining({
            committedRows: 2,
            status: 'completed',
            entryIds: ['entry-uuid-1'],
            groups: 1,
          }),
        }),
      );
    });

    it('refuses with IMPORT_COMMIT_UNBALANCED_GROUP when sum(debit) != sum(credit)', async () => {
      const { service, sessionsRepo, stagingRepo, entries } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeValidatedSession());
      stagingRepo.countBySession.mockResolvedValue({ total: 1, withErrors: 0 });
      stagingRepo.listBySession
        .mockResolvedValue([
          {
            rowNumber: 1,
            mappedValues: {
              journal: 'VTE',
              date: '2026-01-15',
              account: '411000',
              label: 'Orphan debit',
              debit: '100',
              credit: '0',
            },
          },
        ]);

      await expect(
        service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
          ipAddress: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject({
        code: 'IMPORT_COMMIT_UNBALANCED_GROUP',
        details: { groups: [{ journalCode: 'VTE', entryDate: '2026-01-15' }] },
      });

      // Pre-validation runs BEFORE any state change or DB write.
      expect(sessionsRepo.updateStatus).not.toHaveBeenCalled();
      expect(entries.createDraft).not.toHaveBeenCalled();
    });

    it('groups multiple balanced lines on (journalCode, entryDate) into a single entry', async () => {
      const { service, sessionsRepo, stagingRepo, entries } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeValidatedSession());
      stagingRepo.countBySession.mockResolvedValue({ total: 4, withErrors: 0 });
      stagingRepo.listBySession
        .mockResolvedValue([
          ...balancedRows(),
          {
            rowNumber: 3,
            mappedValues: {
              journal: 'ACH',
              date: '2026-01-16',
              account: '607000',
              label: 'Achat',
              debit: '50',
              credit: '0',
            },
          },
          {
            rowNumber: 4,
            mappedValues: {
              journal: 'ACH',
              date: '2026-01-16',
              account: '401000',
              label: 'Achat',
              debit: '0',
              credit: '50',
            },
          },
        ]);
      entries.createDraft
        .mockResolvedValueOnce({ id: 'entry-vte' })
        .mockResolvedValueOnce({ id: 'entry-ach' });

      const result = await service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
        ipAddress: null,
        userAgent: null,
      });

      expect(entries.createDraft).toHaveBeenCalledTimes(2);
      expect(result.entryIds).toEqual(['entry-vte', 'entry-ach']);
    });

    it('groups by pieceNumber: same journal+date but two pieces → two entries', async () => {
      const { service, sessionsRepo, stagingRepo, entries } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeValidatedSession());
      stagingRepo.countBySession.mockResolvedValue({ total: 4, withErrors: 0 });
      stagingRepo.listBySession
        .mockResolvedValue([
          // Pièce 1 — équilibrée
          {
            rowNumber: 1,
            mappedValues: {
              journal: 'ACH',
              date: '2026-01-15',
              account: '601000',
              label: 'Achat pièce 1',
              debit: '100',
              credit: '0',
              pieceNumber: '1',
            },
          },
          {
            rowNumber: 2,
            mappedValues: {
              journal: 'ACH',
              date: '2026-01-15',
              account: '401000',
              label: 'Achat pièce 1',
              debit: '0',
              credit: '100',
              pieceNumber: '1',
            },
          },
          // Pièce 2 — même journal & même date, équilibrée séparément
          {
            rowNumber: 3,
            mappedValues: {
              journal: 'ACH',
              date: '2026-01-15',
              account: '602000',
              label: 'Achat pièce 2',
              debit: '70',
              credit: '0',
              pieceNumber: '2',
            },
          },
          {
            rowNumber: 4,
            mappedValues: {
              journal: 'ACH',
              date: '2026-01-15',
              account: '401000',
              label: 'Achat pièce 2',
              debit: '0',
              credit: '70',
              pieceNumber: '2',
            },
          },
        ]);
      entries.createDraft
        .mockResolvedValueOnce({ id: 'entry-p1' })
        .mockResolvedValueOnce({ id: 'entry-p2' });

      const result = await service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
        ipAddress: null,
        userAgent: null,
      });

      // Deux pièces distinctes → deux écritures (pas une agrégation par jour).
      expect(entries.createDraft).toHaveBeenCalledTimes(2);
      expect(result.entryIds).toEqual(['entry-p1', 'entry-p2']);
      // Le n° de pièce devient la référence de l'écriture.
      const firstDraft = entries.createDraft.mock.calls[0][1] as { reference: string | null };
      expect(firstDraft.reference).toBe('1');
    });

    it('propagates invoice / due date / tax code to the committed entry lines', async () => {
      const { service, sessionsRepo, stagingRepo, entries } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeValidatedSession());
      stagingRepo.countBySession.mockResolvedValue({ total: 2, withErrors: 0 });
      stagingRepo.listBySession
        .mockResolvedValue([
          {
            rowNumber: 1,
            mappedValues: {
              journal: 'ACH',
              date: '2026-01-15',
              account: '601000',
              label: 'Achat ciment',
              debit: '100',
              credit: '0',
              pieceNumber: '1',
              invoiceNumber: '1553602408',
              dueDate: '2026-02-15',
              taxCode: '02',
              reference: 'BELIER',
            },
          },
          {
            rowNumber: 2,
            mappedValues: {
              journal: 'ACH',
              date: '2026-01-15',
              account: '401000',
              label: 'Fournisseur LAFARGE',
              debit: '0',
              credit: '100',
              pieceNumber: '1',
            },
          },
        ]);
      entries.createDraft.mockResolvedValue({ id: 'entry-piece-1' });

      await service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
        ipAddress: null,
        userAgent: null,
      });

      const draftArg = entries.createDraft.mock.calls[0][1] as {
        lines: Array<{
          invoiceNumber?: string | null;
          dueDate?: string | null;
          taxCode?: string | null;
          reference?: string | null;
        }>;
      };
      expect(draftArg.lines[0]).toMatchObject({
        invoiceNumber: '1553602408',
        dueDate: '2026-02-15',
        taxCode: '02',
        reference: 'BELIER',
      });
      expect(draftArg.lines[1]).toMatchObject({
        invoiceNumber: null,
        dueDate: null,
        taxCode: null,
        reference: null,
      });
    });

    it('refuses commit when a single piece is unbalanced (per-piece balance)', async () => {
      const { service, sessionsRepo, stagingRepo, entries } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeValidatedSession());
      stagingRepo.countBySession.mockResolvedValue({ total: 2, withErrors: 0 });
      stagingRepo.listBySession
        .mockResolvedValue([
          {
            rowNumber: 1,
            mappedValues: {
              journal: 'ACH',
              date: '2026-01-15',
              account: '601000',
              label: 'Pièce déséquilibrée',
              debit: '100',
              credit: '0',
              pieceNumber: '7',
            },
          },
          {
            rowNumber: 2,
            mappedValues: {
              journal: 'ACH',
              date: '2026-01-15',
              account: '401000',
              label: 'Pièce déséquilibrée',
              debit: '0',
              credit: '90',
              pieceNumber: '7',
            },
          },
        ]);

      await expect(
        service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
          ipAddress: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject({
        code: 'IMPORT_COMMIT_UNBALANCED_GROUP',
        details: { groups: [{ journalCode: 'ACH', pieceNumber: '7' }] },
      });
      expect(entries.createDraft).not.toHaveBeenCalled();
    });

    it('surfaces IMPORT_COMMIT_FAILED when createDraft fails after the atomic gate', async () => {
      const { service, sessionsRepo, stagingRepo, entries } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeValidatedSession());
      stagingRepo.countBySession.mockResolvedValue({ total: 2, withErrors: 0 });
      stagingRepo.listBySession.mockResolvedValue(balancedRows());
      entries.createDraft.mockRejectedValueOnce(new Error('period closed by race'));

      await expect(
        service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
          ipAddress: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject({ code: 'IMPORT_COMMIT_FAILED' });

      // The atomic gate fired, but the final `completed` transition did NOT.
      expect(sessionsRepo.updateStatus).toHaveBeenCalledWith(
        SESSION_ID,
        ORG_ID,
        'ready_for_import',
      );
      expect(sessionsRepo.updateStatus).not.toHaveBeenCalledWith(SESSION_ID, ORG_ID, 'completed');
    });

    it('refuses when any staging rows have errors', async () => {
      const { service, sessionsRepo, stagingRepo } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeValidatedSession());
      stagingRepo.countBySession.mockResolvedValue({ total: 10, withErrors: 3 });

      await expect(
        service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
          ipAddress: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject({ code: 'IMPORT_SESSION_NOT_VALID' });
    });

    it('refuses when session is not in validated status', async () => {
      const { service, sessionsRepo } = buildService();
      sessionsRepo.findById.mockResolvedValue({
        ...fakeValidatedSession(),
        status: 'parsed' as const,
      });

      await expect(
        service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
          ipAddress: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject({ code: 'IMPORT_SESSION_NOT_PARSED' });
    });

    it('is idempotent: already-completed session returns totals without re-committing', async () => {
      const { service, sessionsRepo, stagingRepo, audit } = buildService();
      sessionsRepo.findById.mockResolvedValue({
        ...fakeValidatedSession(),
        status: 'completed' as const,
      });
      stagingRepo.countBySession.mockResolvedValue({ total: 5, withErrors: 0 });

      const result = await service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
        ipAddress: null,
        userAgent: null,
      });

      expect(result.committedRows).toBe(5);
      expect(sessionsRepo.updateStatus).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('returns 404 when session not found', async () => {
      const { service, sessionsRepo } = buildService();
      sessionsRepo.findById.mockResolvedValue(null);

      await expect(
        service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
          ipAddress: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject({ code: 'IMPORT_SESSION_NOT_FOUND' });
    });
  });

  // ─── commitSession — trial_balance auto-provisioning ─────────────
  //
  // Lorsqu'une session `trial_balance` Sage (comptes 8 chiffres) est
  // committée contre un plan org plus court (3-6 chiffres), les
  // sous-comptes manquants sont créés automatiquement à partir du
  // parent SYSCOHADA détecté par préfixe. Couvre :
  //   - smoke : 3 comptes inconnus, 3 parents trouvés → 3 créations,
  //     re-validation vide les erreurs, commit OK,
  //   - idempotence : 2e passage = 0 création,
  //   - documentType `entries` : aucune auto-création,
  //   - compte sans parent matché : ignoré, le commit continue.
  describe('commitSession — trial_balance auto-provision', () => {
    const REF_PARENTS = [
      { code: '101', label: 'Capital social', class: 1, normalBalance: 'C' },
      { code: '213', label: 'Bâtiments', class: 2, normalBalance: 'D' },
      { code: '311', label: 'Marchandises A', class: 3, normalBalance: 'D' },
    ] as const;

    function balanceSession(): ImportSessionEntity {
      return fakeSession({
        status: 'validated',
        mappingOverride: { __documentType: 'trial_balance' },
      });
    }

    function balanceRows(): Array<{
      id: string;
      rowNumber: number;
      mappedValues: Record<string, string | null>;
    }> {
      // 3 lignes balance : compte / label / debit / credit
      // (pas de journal ni de date — c'est le pattern balance).
      return [
        {
          id: 'r1',
          rowNumber: 1,
          mappedValues: {
            journal: 'BAL',
            date: '2026-01-31',
            account: '10100000',
            label: 'Capital',
            debit: '0',
            credit: '1000',
          },
        },
        {
          id: 'r2',
          rowNumber: 2,
          mappedValues: {
            journal: 'BAL',
            date: '2026-01-31',
            account: '21310000',
            label: 'Bâtiments',
            debit: '600',
            credit: '0',
          },
        },
        {
          id: 'r3',
          rowNumber: 3,
          mappedValues: {
            journal: 'BAL',
            date: '2026-01-31',
            account: '31100000',
            label: 'Stocks',
            debit: '400',
            credit: '0',
          },
        },
      ];
    }

    function referenceFindByCodeImpl(code: string) {
      const hit = REF_PARENTS.find((p) => p.code === code);
      return Promise.resolve(hit ? { ...hit } : null);
    }

    it('auto-creates 3 missing sub-accounts when parents exist in SYSCOHADA reference', async () => {
      const { service, sessionsRepo, stagingRepo, chartRepo, referenceRepo, entries, audit } =
        buildService();
      sessionsRepo.findById.mockResolvedValue(balanceSession());
      // First countBySession (post-provision) returns 0 errors.
      stagingRepo.countBySession.mockResolvedValue({ total: 3, withErrors: 0 });
      // `loadAllStagingRows` page-breaks after a single < 500-row page;
      // mockResolvedValue covers every call (auto-provision + revalidation
      // + commit) with the same payload.
      stagingRepo.listBySession.mockResolvedValue(balanceRows());
      referenceRepo.listBySystem.mockResolvedValue(REF_PARENTS.map((p) => ({ code: p.code })));
      referenceRepo.findByCode.mockImplementation(referenceFindByCodeImpl);
      // findByCode on chartRepo: returns null for the 3 leaves AND for
      // the 3 parents (no org-account exists for 101/213/311 either).
      chartRepo.findByCode.mockResolvedValue(null);
      entries.createDraft.mockResolvedValue({ id: 'entry-bal' });

      const result = await service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
        ipAddress: null,
        userAgent: null,
      });

      expect(result.autoCreatedAccounts).toBe(3);
      expect(chartRepo.create).toHaveBeenCalledTimes(3);
      const createdCodes = chartRepo.create.mock.calls.map((c) => c[0].code).sort();
      expect(createdCodes).toEqual(['10100000', '21310000', '31100000']);
      // Each call must reference its parent SYSCOHADA code.
      const parentByLeaf = Object.fromEntries(
        chartRepo.create.mock.calls.map((c) => [c[0].code, c[0].label]),
      );
      expect(parentByLeaf['10100000']).toContain('Capital');
      expect(parentByLeaf['21310000']).toContain('Bâtiments');
      // Audit emitted for each creation.
      const autoCreateAuditCalls = audit.record.mock.calls.filter(
        (c) => c[0].action === 'organization_account.auto_created_from_balance',
      );
      expect(autoCreateAuditCalls).toHaveLength(3);
    });

    it('is idempotent: a 2nd commit on already-provisioned accounts creates none', async () => {
      const { service, sessionsRepo, stagingRepo, chartRepo, referenceRepo, entries } =
        buildService();
      sessionsRepo.findById.mockResolvedValue(balanceSession());
      stagingRepo.countBySession.mockResolvedValue({ total: 3, withErrors: 0 });
      // `loadAllStagingRows` page-breaks once page.length < 500 — so a
      // single call returns the whole page. mockResolvedValue is used
      // (not Once) so both calls (auto-provision + commit) see the rows.
      stagingRepo.listBySession.mockResolvedValue(balanceRows());
      referenceRepo.listBySystem.mockResolvedValue(REF_PARENTS.map((p) => ({ code: p.code })));
      referenceRepo.findByCode.mockImplementation(referenceFindByCodeImpl);
      // Simulate "already exists" — listByOrganization returns the 3
      // leaf accounts so they are NOT in candidateCodes minus existing.
      chartRepo.listByOrganization.mockResolvedValue([
        { code: '10100000', accountType: 'POSTING', isActive: true },
        { code: '21310000', accountType: 'POSTING', isActive: true },
        { code: '31100000', accountType: 'POSTING', isActive: true },
      ]);
      entries.createDraft.mockResolvedValue({ id: 'entry-bal' });

      const result = await service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
        ipAddress: null,
        userAgent: null,
      });

      expect(result.autoCreatedAccounts).toBe(0);
      expect(chartRepo.create).not.toHaveBeenCalled();
    });

    it('does NOT auto-provision when documentType is not trial_balance', async () => {
      const { service, sessionsRepo, stagingRepo, chartRepo, entries } = buildService();
      // entries-type session — no __documentType override == defaults to entries.
      sessionsRepo.findById.mockResolvedValue(fakeValidatedSessionLocal());
      stagingRepo.countBySession.mockResolvedValue({ total: 2, withErrors: 0 });
      stagingRepo.listBySession
        .mockResolvedValue(balancedRowsLocal());
      entries.createDraft.mockResolvedValue({ id: 'entry-x' });

      const result = await service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
        ipAddress: null,
        userAgent: null,
      });

      expect(result.autoCreatedAccounts).toBeUndefined();
      expect(chartRepo.create).not.toHaveBeenCalled();
    });

    it('skips an account whose prefix matches no SYSCOHADA parent', async () => {
      const { service, sessionsRepo, stagingRepo, chartRepo, referenceRepo, entries } =
        buildService();
      sessionsRepo.findById.mockResolvedValue(balanceSession());
      stagingRepo.countBySession.mockResolvedValue({ total: 1, withErrors: 0 });
      const mysteryRow = [
        {
          id: 'r1',
          rowNumber: 1,
          mappedValues: {
            journal: 'BAL',
            date: '2026-01-31',
            account: '99999999',
            label: 'Mystery',
            debit: '0',
            credit: '0',
          },
        },
      ];
      stagingRepo.listBySession.mockResolvedValue(mysteryRow);
      // Reference has NO 99/999/etc. prefix.
      referenceRepo.listBySystem.mockResolvedValue([]);
      referenceRepo.findByCode.mockResolvedValue(null);
      entries.createDraft.mockResolvedValue({ id: 'entry-bal' });

      const result = await service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
        ipAddress: null,
        userAgent: null,
      });

      expect(result.autoCreatedAccounts).toBe(0);
      expect(chartRepo.create).not.toHaveBeenCalled();
    });

    // Helpers reused from the parent describe — re-declared locally to
    // avoid hoisting weirdness between sibling describes.
    function fakeValidatedSessionLocal() {
      return {
        id: SESSION_ID,
        organizationId: ORG_ID,
        status: 'validated' as const,
        sourceType: 'csv' as const,
        label: null,
        totalLines: 2,
        errorLines: 0,
        createdAt: new Date(),
        stagingEntries: [],
        files: [],
        createdBy: null,
        createdById: USER_ID,
        company: null,
        companyId: null,
        fiscalYear: null,
        failureReason: null,
        mappingOverride: null,
      };
    }
    function balancedRowsLocal() {
      return [
        {
          id: 'r1',
          rowNumber: 1,
          mappedValues: {
            journal: 'VTE',
            date: '2026-01-15',
            account: '411000',
            label: 'Facture A',
            debit: '100',
            credit: '0',
          },
        },
        {
          id: 'r2',
          rowNumber: 2,
          mappedValues: {
            journal: 'VTE',
            date: '2026-01-15',
            account: '707000',
            label: 'Facture A',
            debit: '0',
            credit: '100',
          },
        },
      ];
    }
  });

  // ─── updateMappingOverride ────────────────────────────────────────
  //
  // Wave 2 — surface UI lets the user fix columns the auto-mapper got
  // wrong (issue projet-ferme-3wy). Three contracts matter here:
  //   1. The override JSONB is persisted as-given (mapping retention).
  //   2. A `validated` session is rewound to `parsed` so the user is
  //      forced to re-run preview after changing the mapping — without
  //      this the stale `errorLines` counter would mislead the commit
  //      gate.
  //   3. The repository call is scoped by `organizationId`, so a session
  //      belonging to another org surfaces as `IMPORT_SESSION_NOT_FOUND`
  //      (we deliberately do not distinguish the two cases to avoid
  //      leaking session existence across tenants).
  describe('updateMappingOverride', () => {
    it('persists the override JSONB on a parsed session and keeps the status', async () => {
      const { service, sessionsRepo, audit } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeSession({ status: 'parsed' }));

      const override = { 'N°DE COMPTE': 'account', LIBELLE: 'label' };
      await service.updateMappingOverride(asTenantId(ORG_ID), SESSION_ID, override, USER_ID, {
        ipAddress: null,
        userAgent: null,
      });

      expect(sessionsRepo.updateMappingOverride).toHaveBeenCalledWith(
        SESSION_ID,
        ORG_ID,
        // documentType key wasn't present on the source session, so the
        // merged payload equals the user-supplied override verbatim.
        override,
      );
      // No status transition expected from `parsed`.
      expect(sessionsRepo.updateStatus).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'mapping_override_updated',
          legacyEventType: 'imports.mapping_updated',
        }),
      );
    });

    it('rewinds a validated session back to parsed so the user must re-run preview', async () => {
      const { service, sessionsRepo } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeSession({ status: 'validated' }));

      await service.updateMappingOverride(
        asTenantId(ORG_ID),
        SESSION_ID,
        { date: 'date' },
        USER_ID,
        { ipAddress: null, userAgent: null },
      );

      expect(sessionsRepo.updateMappingOverride).toHaveBeenCalled();
      expect(sessionsRepo.updateStatus).toHaveBeenCalledWith(SESSION_ID, ORG_ID, 'parsed');
    });

    it('refuses to update a session from another org (findById scoped → not found)', async () => {
      const { service, sessionsRepo } = buildService();
      // Tenant scoping is enforced inside the repository — from the
      // service perspective this manifests as `findById` returning null
      // when the session belongs to another org.
      sessionsRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateMappingOverride(
          asTenantId(ORG_ID),
          SESSION_ID,
          { account: 'account' },
          USER_ID,
          { ipAddress: null, userAgent: null },
        ),
      ).rejects.toBeInstanceOf(AppException);
      await expect(
        service.updateMappingOverride(
          asTenantId(ORG_ID),
          SESSION_ID,
          { account: 'account' },
          USER_ID,
          { ipAddress: null, userAgent: null },
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.IMPORT_SESSION_NOT_FOUND });

      expect(sessionsRepo.updateMappingOverride).not.toHaveBeenCalled();
      expect(sessionsRepo.updateStatus).not.toHaveBeenCalled();
    });
  });

  // ─── updateSession (label + documentType) ───────────────────────────

  describe('updateSession', () => {
    it('updates only the label without touching mapping_override when documentType is absent', async () => {
      const { service, sessionsRepo, audit } = buildService();
      const before = fakeSession({ label: 'old', status: 'parsed' });
      const after = fakeSession({ label: 'new', status: 'parsed' });
      sessionsRepo.findById.mockResolvedValueOnce(before).mockResolvedValueOnce(after);

      const result = await service.updateSession(
        asTenantId(ORG_ID),
        SESSION_ID,
        { label: 'new' },
        USER_ID,
        { ipAddress: null, userAgent: null },
      );

      expect(result.label).toBe('new');
      expect(sessionsRepo.updateLabel).toHaveBeenCalledWith(SESSION_ID, ORG_ID, 'new');
      expect(sessionsRepo.updateMappingOverride).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'session_updated' }),
      );
    });

    it('normalises an empty/whitespace label to null', async () => {
      const { service, sessionsRepo } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeSession({ label: 'old', status: 'parsed' }));

      await service.updateSession(asTenantId(ORG_ID), SESSION_ID, { label: '   ' }, USER_ID, {
        ipAddress: null,
        userAgent: null,
      });

      expect(sessionsRepo.updateLabel).toHaveBeenCalledWith(SESSION_ID, ORG_ID, null);
    });

    it('refuses changing documentType on a completed session', async () => {
      const { service, sessionsRepo } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeSession({ status: 'completed' }));

      await expect(
        service.updateSession(
          asTenantId(ORG_ID),
          SESSION_ID,
          { documentType: 'trial_balance' },
          USER_ID,
          { ipAddress: null, userAgent: null },
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.IMPORT_SESSION_CANNOT_DELETE });

      expect(sessionsRepo.updateLabel).not.toHaveBeenCalled();
      expect(sessionsRepo.updateMappingOverride).not.toHaveBeenCalled();
    });

    it('rejects an empty patch with IMPORT_SESSION_NOT_VALID', async () => {
      const { service, sessionsRepo } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeSession({ status: 'parsed' }));

      await expect(
        service.updateSession(asTenantId(ORG_ID), SESSION_ID, {}, USER_ID, {
          ipAddress: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.IMPORT_SESSION_NOT_VALID });
    });

    it('throws NOT_FOUND when the session does not exist', async () => {
      const { service, sessionsRepo } = buildService();
      sessionsRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateSession(asTenantId(ORG_ID), SESSION_ID, { label: 'whatever' }, USER_ID, {
          ipAddress: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.IMPORT_SESSION_NOT_FOUND });
    });
  });

  // ─── deleteSession ──────────────────────────────────────────────────

  describe('deleteSession', () => {
    it('refuses to delete a completed session', async () => {
      const { service, sessionsRepo } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeSession({ status: 'completed' }));

      await expect(
        service.deleteSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
          ipAddress: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.IMPORT_SESSION_CANNOT_DELETE });

      expect(sessionsRepo.deleteById).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND when the session is absent', async () => {
      const { service, sessionsRepo } = buildService();
      sessionsRepo.findById.mockResolvedValue(null);

      await expect(
        service.deleteSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
          ipAddress: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.IMPORT_SESSION_NOT_FOUND });
    });

    it('deletes the session, emits audit, and survives missing-file cleanup', async () => {
      const { service, sessionsRepo, filesRepo, audit } = buildService();
      sessionsRepo.findById.mockResolvedValue(
        fakeSession({ status: 'failed', label: 'bad import' }),
      );
      filesRepo.listBySession.mockResolvedValue([
        { id: FILE_ID, storagePath: `${ORG_ID}/${SESSION_ID}/missing.csv` },
      ]);
      sessionsRepo.deleteById.mockResolvedValue(1);

      await expect(
        service.deleteSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
          ipAddress: null,
          userAgent: null,
        }),
      ).resolves.toBeUndefined();

      expect(sessionsRepo.deleteById).toHaveBeenCalledWith(SESSION_ID, ORG_ID);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'session_deleted',
          legacyEventType: 'imports.session_deleted',
          before: expect.objectContaining({
            status: 'failed',
            label: 'bad import',
            fileCount: 1,
          }),
        }),
      );
    });

    it('treats a 0-row DELETE as a race-condition NOT_FOUND', async () => {
      const { service, sessionsRepo } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeSession({ status: 'parsed' }));
      sessionsRepo.deleteById.mockResolvedValue(0);

      await expect(
        service.deleteSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
          ipAddress: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.IMPORT_SESSION_NOT_FOUND });
    });
  });
});
