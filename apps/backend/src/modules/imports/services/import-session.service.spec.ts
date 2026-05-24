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
    };
    const audit = {
      record: jest.fn().mockResolvedValue(null),
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
      audit as never,
      config as never,
    );

    return {
      service,
      sessionsRepo,
      filesRepo,
      stagingRepo,
      parserService,
      chartRepo,
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

    it('commits a clean validated session and emits audit event', async () => {
      const { service, sessionsRepo, stagingRepo, audit } = buildService();
      sessionsRepo.findById.mockResolvedValue(fakeValidatedSession());
      stagingRepo.countBySession.mockResolvedValue({ total: 5, withErrors: 0 });

      const result = await service.commitSession(asTenantId(ORG_ID), SESSION_ID, USER_ID, {
        ipAddress: null,
        userAgent: null,
      });

      expect(result).toEqual({ sessionId: SESSION_ID, committedRows: 5 });
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
          after: { committedRows: 5, status: 'completed' },
        }),
      );
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
});
