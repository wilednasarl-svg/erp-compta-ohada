import type { Readable } from 'stream';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { AppConfig } from '../../../config/configuration';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import type { DocumentEntity } from '../entities/document.entity';
import type { OcrStatus } from '../types/ocr-status';
import {
  DocumentRepository,
  type DocumentListFilters,
  type PaginationOptions,
} from '../repositories/document.repository';
import { DocumentEntryRepository } from '../repositories/document-entry.repository';
import { DOCUMENT_STORAGE, type DocumentStorage } from './document-storage.interface';
import { DocumentOcrService } from './document-ocr.service';

/**
 * Plain-shape upload descriptor. The controller adapts the multer
 * `Express.Multer.File` into this so the service stays free of any
 * HTTP coupling and is trivially unit-testable.
 */
export interface UploadFileInput {
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly body: Buffer;
}

export interface CreateDocumentOptions {
  readonly tags?: ReadonlyArray<string>;
  readonly linkedEntryIds?: ReadonlyArray<string>;
  readonly description?: string | null;
}

/**
 * Read-model returned to controllers. Hides storage internals
 * (`storage_key`, raw `Buffer` size as a string) and exposes a
 * `downloadUrl` pointer the client uses to retrieve the bytes.
 */
export interface DocumentView {
  readonly id: string;
  readonly organizationId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256Checksum: string;
  readonly tags: ReadonlyArray<string>;
  readonly description: string | null;
  readonly ocrStatus: OcrStatus;
  readonly uploadedBy: string;
  readonly uploadedAt: string;
  readonly createdAt: string;
  readonly downloadUrl: string;
}

export interface ListDocumentsResult {
  readonly rows: ReadonlyArray<DocumentView>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Allow-list of MIME prefixes accepted in wave 1. Wider than the
 * accounting import surface because a document can be a contract,
 * a scanned voucher, an Excel attachment, a freeform note. Anything
 * outside this list is rejected with `DOC_MIME_REJECTED` so a future
 * config can extend it without surprising existing callers.
 */
/*
 * MIME allowlist for /documents uploads.
 *
 * Tightening (audit Module 3 Sec-M3): the previous catch-all `'text/'`
 * prefix accepted `text/html` and `text/javascript`, which the download
 * endpoint would have served back as `Content-Type: text/html` —
 * stored XSS vector for users opening the URL in a tab where
 * `Content-Disposition: attachment` is ignored. Replaced with the
 * narrow exact-allowlist below. The `image/` prefix stays (covers PNG,
 * JPEG, WebP, HEIC of scanned vouchers) and `application/vnd.` stays
 * (covers all Office / OpenDocument variants).
 *
 * Anything outside this list returns `DOC_MIME_REJECTED` (422).
 */
const ACCEPTED_MIME_PREFIXES = ['image/', 'application/pdf', 'application/vnd.'];

const ACCEPTED_MIME_EXACT = new Set<string>([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.text',
  // Only specific text/* — `text/html` and `text/javascript` are
  // intentionally NOT in this list.
  'text/csv',
  'text/plain',
  'application/zip',
  'application/octet-stream',
]);

/**
 * `DocumentsService` (BE-DOC-04) — orchestrates the storage driver,
 * the row persistence and the OCR hook.
 *
 * Tenant invariant
 * ----------------
 * Every public method takes the tenant id from the controller (which
 * itself reads it from the JWT-derived `CurrentOrg`). Internal repository
 * calls all pass through `assertTenantId`. The `getForOrg` /
 * `softDelete` paths return `DOC_NOT_FOUND` (404) for cross-tenant
 * access — never 403 — to match the spec's "no info disclosure"
 * policy.
 *
 * Audit (BE-DOC-09 / Module 7 vague 1)
 * ------------------------------------
 * Every state-changing operation appends a row to the unified audit
 * journal via `AuditTrailService.record(...)` with
 * `module: 'documents'` and one of three actions:
 *
 *   - `uploaded`     — emitted after the row is persisted and the
 *                       bytes survived storage. Carries the immutable
 *                       facts (filename, mimeType, sizeBytes, sha256)
 *                       in `after`; `before` is null (creation).
 *   - `linked_entry` — emitted ONCE per upload if `linkedEntryIds`
 *                       was non-empty. Forensic: lets an auditor reconstruct
 *                       which écritures a scan was attached to.
 *   - `soft_deleted` — emitted after `documents.softDelete` succeeds.
 *                       `before` snapshots the removed row; `after`
 *                       is null.
 *
 * Failures from the audit write are swallowed inside `AuditTrailService`
 * (swallow-and-warn) so a flaky journal cannot brick an upload or
 * a deletion.
 */
@Injectable()
export class DocumentsService {
  private static readonly MODULE = 'documents' as const;
  private static readonly ENTITY_TYPE = 'document' as const;

  private readonly logger = new Logger(DocumentsService.name);
  private readonly maxFileSizeBytes: number;

  constructor(
    private readonly documents: DocumentRepository,
    private readonly entries: DocumentEntryRepository,
    private readonly ocr: DocumentOcrService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    private readonly audit: AuditTrailService,
    config: ConfigService,
  ) {
    const docConfig = config.get<AppConfig['documents']>('documents');
    if (docConfig === undefined) {
      throw new Error('AppConfig.documents missing — configuration() not loaded');
    }
    this.maxFileSizeBytes = docConfig.maxFileSizeBytes;
  }

  async createFromUpload(
    organizationId: string,
    actorUserId: string,
    file: UploadFileInput | undefined,
    options: CreateDocumentOptions = {},
    ctx: AuditContext = { ipAddress: null, userAgent: null },
  ): Promise<DocumentView> {
    if (file === undefined) {
      throw new AppException(ERROR_CODES.DOC_FILE_REQUIRED, {
        message: 'Multipart field "file" is required',
      });
    }
    this.assertMimeAccepted(file.mimeType);
    if (file.sizeBytes <= 0) {
      throw new AppException(ERROR_CODES.DOC_FILE_REQUIRED, {
        message: 'Uploaded file is empty',
      });
    }
    if (file.sizeBytes > this.maxFileSizeBytes) {
      throw new AppException(ERROR_CODES.DOC_FILE_TOO_LARGE, {
        message: `File exceeds the ${this.maxFileSizeBytes} bytes limit`,
        details: { maxBytes: this.maxFileSizeBytes, actualBytes: file.sizeBytes },
      });
    }

    const tags = this.normalizeTags(options.tags);
    const linkedEntryIds = this.normalizeEntryIds(options.linkedEntryIds);

    const stored = await this.storage.save({
      organizationId,
      originalName: file.originalName,
      mimeType: file.mimeType,
      body: file.body,
    });

    // The storage driver re-computes size from the actual bytes
    // written; trust THAT value over the multer-reported one (multer
    // can over-report when a stream gets truncated mid-flight). If
    // the driver-side count is over the limit it means multer let
    // through more bytes than its own limit — fail closed.
    if (stored.sizeBytes > this.maxFileSizeBytes) {
      await this.storage.delete(stored.storageKey).catch((error: unknown) => {
        this.logger.warn(
          `createFromUpload: failed to roll back oversize file ${stored.storageKey}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      throw new AppException(ERROR_CODES.DOC_FILE_TOO_LARGE, {
        message: `File exceeds the ${this.maxFileSizeBytes} bytes limit`,
      });
    }

    // Dedup probe — not a hard error: the same scan can legitimately
    // back several different vouchers in the same org. Log at INFO so
    // ops can spot pathological re-upload patterns.
    const existing = await this.documents.findActiveBySha256(organizationId, stored.sha256Checksum);
    if (existing.length > 0) {
      this.logger.log(
        `createFromUpload: org=${organizationId} re-uploaded sha256=${stored.sha256Checksum} ` +
          `(already attached to ${existing.length} document(s)) — proceeding`,
      );
    }

    let row: DocumentEntity;
    try {
      row = await this.documents.createOne({
        organizationId,
        filename: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: stored.sizeBytes,
        sha256Checksum: stored.sha256Checksum,
        storageKey: stored.storageKey,
        tags,
        description: this.normalizeDescription(options.description),
        uploadedBy: actorUserId,
      });
    } catch (error: unknown) {
      // Row write failed AFTER the bytes were persisted — best-effort
      // rollback so we don't leak orphan storage. Failures here are
      // swallow-and-warn: the user-facing error is the original DB one.
      await this.storage.delete(stored.storageKey).catch((cleanupError: unknown) => {
        this.logger.warn(
          `createFromUpload: failed to roll back orphan storage ${stored.storageKey}: ${
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          }`,
        );
      });
      throw error;
    }

    if (linkedEntryIds.length > 0) {
      await this.entries.link({
        organizationId,
        documentId: row.id,
        entryIds: linkedEntryIds,
        createdBy: actorUserId,
      });
    }

    // Module 7 audit emission. `uploaded` carries the immutable facts
    // in `after`; `linked_entry` is emitted separately so a forensic
    // search by `entityId=document_id` returns both rows in order.
    await this.audit.record({
      module: DocumentsService.MODULE,
      action: 'uploaded',
      entityType: DocumentsService.ENTITY_TYPE,
      entityId: row.id,
      after: {
        filename: row.filename,
        mimeType: row.mimeType,
        sizeBytes: Number(row.sizeBytes),
        sha256Checksum: row.sha256Checksum,
        tags: [...(row.tags ?? [])],
        description: row.description,
      },
      metadata: {
        storageKey: row.storageKey,
        linkedEntryCount: linkedEntryIds.length,
      },
      ctx: { ...ctx, userId: actorUserId, organizationId },
      legacyEventType: 'documents.uploaded',
    });

    if (linkedEntryIds.length > 0) {
      await this.audit.record({
        module: DocumentsService.MODULE,
        action: 'linked_entry',
        entityType: DocumentsService.ENTITY_TYPE,
        entityId: row.id,
        after: { entryIds: [...linkedEntryIds] },
        metadata: { entryCount: linkedEntryIds.length },
        ctx: { ...ctx, userId: actorUserId, organizationId },
        legacyEventType: 'documents.linked_entry',
      });
    }

    // Fire-and-forget. The stub returns immediately; a wave-2
    // implementation may enqueue an async job, in which case any
    // failure to enqueue MUST NOT brick the upload.
    this.ocr.requestOcr(row.id, organizationId).catch((error: unknown) => {
      this.logger.warn(
        `createFromUpload: OCR request failed for document ${row.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

    return this.toView(row);
  }

  async getForOrg(organizationId: string, id: string): Promise<DocumentView> {
    const row = await this.documents.findById(organizationId, id);
    if (row === null) {
      throw new AppException(ERROR_CODES.DOC_NOT_FOUND, {
        message: 'Document not found',
      });
    }
    return this.toView(row);
  }

  /**
   * Returns the binary stream alongside the metadata the controller
   * needs to write the response headers (filename, content type).
   * Translates a storage-level miss into `DOC_NOT_FOUND` so a row
   * with a stale `storage_key` (e.g. partially-restored backup) still
   * surfaces a clean 404 to the caller.
   */
  async openStreamForOrg(
    organizationId: string,
    id: string,
  ): Promise<{
    readonly stream: Readable;
    readonly filename: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
  }> {
    const row = await this.documents.findById(organizationId, id);
    if (row === null) {
      throw new AppException(ERROR_CODES.DOC_NOT_FOUND, {
        message: 'Document not found',
      });
    }
    const stream = await this.storage.getStream(row.storageKey);
    return {
      stream,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
    };
  }

  async listForOrg(
    organizationId: string,
    filters: DocumentListFilters,
    pagination: PaginationOptions,
  ): Promise<ListDocumentsResult> {
    const { rows, total } = await this.documents.listForOrg(organizationId, filters, pagination);
    return {
      rows: rows.map((row) => this.toView(row)),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  }

  async softDelete(
    organizationId: string,
    id: string,
    actorUserId: string,
    ctx: AuditContext = { ipAddress: null, userAgent: null },
  ): Promise<void> {
    const row = await this.documents.findById(organizationId, id);
    if (row === null) {
      throw new AppException(ERROR_CODES.DOC_NOT_FOUND, {
        message: 'Document not found',
      });
    }
    await this.documents.softDelete(organizationId, id, actorUserId);
    // Physical storage is retained until a janitor sweeps it (Module
    // 10 wave 3). Soft-delete is reversible at the row level; reaping
    // bytes too early would leak before we add the undo path.

    await this.audit.record({
      module: DocumentsService.MODULE,
      action: 'soft_deleted',
      entityType: DocumentsService.ENTITY_TYPE,
      entityId: id,
      before: {
        filename: row.filename,
        mimeType: row.mimeType,
        sizeBytes: Number(row.sizeBytes),
        tags: [...(row.tags ?? [])],
      },
      after: null,
      metadata: { sha256Checksum: row.sha256Checksum },
      ctx: { ...ctx, userId: actorUserId, organizationId },
      legacyEventType: 'documents.soft_deleted',
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private toView(row: DocumentEntity): DocumentView {
    return {
      id: row.id,
      organizationId: row.organizationId,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
      sha256Checksum: row.sha256Checksum,
      tags: [...(row.tags ?? [])],
      description: row.description,
      ocrStatus: row.ocrStatus,
      uploadedBy: row.uploadedBy,
      uploadedAt: row.uploadedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      downloadUrl: `/documents/${row.id}/content`,
    };
  }

  private normalizeTags(tags: ReadonlyArray<string> | undefined): string[] {
    if (tags === undefined) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of tags) {
      const trimmed = raw.trim();
      if (trimmed.length === 0 || trimmed.length > 64) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= 32) break;
    }
    return out;
  }

  private normalizeEntryIds(ids: ReadonlyArray<string> | undefined): string[] {
    if (ids === undefined) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of ids) {
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      if (trimmed.length === 0 || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
    return out;
  }

  private normalizeDescription(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    return trimmed.slice(0, 2000);
  }

  private assertMimeAccepted(mimeType: string): void {
    if (ACCEPTED_MIME_EXACT.has(mimeType)) return;
    if (ACCEPTED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) return;
    throw new AppException(ERROR_CODES.DOC_MIME_REJECTED, {
      message: `MIME type '${mimeType}' is not accepted for documents`,
      details: { mimeType },
    });
  }
}
