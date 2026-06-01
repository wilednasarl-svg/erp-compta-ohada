import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { Readable } from 'stream';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import type { AppConfig } from '../../../config/configuration';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { JournalEntryRepository } from '../../journals/repositories/journal-entry.repository';
import {
  EntriesService,
  type CreateEntryInput,
  type EntryView,
} from '../../journals/services/entries.service';
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
import { extractInvoice, type ExtractedInvoice } from './invoice-extractor';
import {
  buildPurchaseEntryProposal,
  type ProposalOptions,
  type ProposedEntry,
} from './journal-entry-proposal';
import { extractInvoiceMetadata } from './metadata-extractor';
import { OCR_PROVIDER, type OcrDiagnostics, type OcrProvider } from './ocr-provider';

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
  /**
   * Number of journal entries this document is attached to. Populated
   * only on the list path (where it is computed in a single batched
   * query); absent on single-document reads where the client does not
   * need it. Lets the UI warn before deleting a justificatif that
   * supports one or more écritures.
   */
  readonly linkedEntryCount?: number;
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
    @Inject(OCR_PROVIDER) private readonly ocrProvider: OcrProvider,
    private readonly journalEntries: JournalEntryRepository,
    private readonly entriesService: EntriesService,
  ) {
    const docConfig = config.get<AppConfig['documents']>('documents');
    if (docConfig === undefined) {
      throw new Error('AppConfig.documents missing — configuration() not loaded');
    }
    this.maxFileSizeBytes = docConfig.maxFileSizeBytes;
  }

  async createFromUpload(
    organizationId: TenantId,
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

    // Module 10 wave 2 — inline OCR pipeline. Fire-and-forget: any
    // OCR/extraction failure is swallowed-and-warned so a flaky engine
    // never blocks an upload.
    this.runOcrPipeline(row.id, organizationId, row.storageKey, row.mimeType).catch(
      (error: unknown) => {
        this.logger.warn(
          `createFromUpload: OCR pipeline failed for document ${row.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      },
    );

    return this.toView(row);
  }

  /**
   * Attach an existing document to a journal entry. The
   * `document_entries` pivot is the source of truth — this method
   * validates that both the document and the entry belong to the
   * caller's tenant, then upserts (idempotent) the link row.
   *
   * Failure modes:
   *   - DOC_NOT_FOUND           : document missing / cross-tenant.
   *   - JOURNAL_ENTRY_NOT_FOUND : entry missing / cross-tenant.
   */
  async attachEntry(
    organizationId: TenantId,
    documentId: string,
    journalEntryId: string,
    actorUserId: string,
    ctx: AuditContext = { ipAddress: null, userAgent: null },
  ): Promise<{ documentId: string; entryId: string }> {
    const doc = await this.documents.findById(organizationId, documentId);
    if (doc === null) {
      throw new AppException(ERROR_CODES.DOC_NOT_FOUND, {
        message: 'Document not found',
      });
    }
    const entry = await this.journalEntries.findById(journalEntryId, organizationId);
    if (entry === null) {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_NOT_FOUND, {
        message: 'Journal entry not found',
      });
    }
    await this.entries.link({
      organizationId,
      documentId,
      entryIds: [journalEntryId],
      createdBy: actorUserId,
    });

    await this.audit.record({
      module: DocumentsService.MODULE,
      action: 'linked_entry',
      entityType: DocumentsService.ENTITY_TYPE,
      entityId: documentId,
      after: { entryIds: [journalEntryId] },
      metadata: { entryCount: 1, source: 'attach-entry-endpoint' },
      ctx: { ...ctx, userId: actorUserId, organizationId },
      legacyEventType: 'documents.linked_entry',
    });

    return { documentId, entryId: journalEntryId };
  }

  /**
   * Create a draft journal entry from a document's OCR-extracted invoice.
   * Rebuilds the SYSCOHADA purchase proposal from `extracted_metadata`
   * (applying any account/journal overrides), posts it via the journals
   * service (which enforces balance, journal existence and an open
   * period), then links the document to the new entry.
   *
   * Throws:
   *   - DOC_NOT_FOUND               : document missing / cross-tenant.
   *   - JOURNAL_ENTRY_EMPTY_LINES   : no usable OCR proposal (run OCR first).
   *   - (journals errors)           : JOURNAL_NOT_FOUND, ACCOUNTING_PERIOD_*,
   *                                   JOURNAL_ENTRY_UNBALANCED, … bubble up.
   */
  async createEntryFromOcr(
    organizationId: TenantId,
    documentId: string,
    overrides: ProposalOptions,
    actorUserId: string,
    ctx: AuditContext = { ipAddress: null, userAgent: null },
  ): Promise<{ entry: EntryView; documentId: string; warnings: ReadonlyArray<string> }> {
    const doc = await this.documents.findById(organizationId, documentId);
    if (doc === null) {
      throw new AppException(ERROR_CODES.DOC_NOT_FOUND, { message: 'Document not found' });
    }

    const proposal = this.buildProposalFromMetadata(doc.extractedMetadata, overrides);
    if (proposal === null || proposal.entryDate === null || proposal.lines.length < 2) {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_EMPTY_LINES, {
        message:
          "Aucune écriture exploitable n'a pu être construite depuis l'OCR de ce document — lancez l'OCR d'abord.",
      });
    }

    // Garde-fous « écriture correcte quelle que soit la qualité de l'image » :
    // l'OCR peut mal lire une pièce (scan/manuscrit) → on REFUSE de créer une
    // écriture fausse. Défense en profondeur côté serveur (l'UI bloque déjà le
    // déséquilibre, mais l'endpoint est appelable directement). L'utilisateur
    // corrige alors les données (saisie manuelle) avant de poster.
    const problems: string[] = [];
    const entryYear = Number(proposal.entryDate.slice(0, 4));
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(entryYear) || entryYear < 2000 || entryYear > currentYear + 1) {
      problems.push(`la date « ${proposal.entryDate} » est implausible (lecture OCR douteuse)`);
    }
    if (!proposal.balanced) {
      problems.push(
        "les montants sont absents ou l'écriture est déséquilibrée (débit ≠ crédit)",
      );
    }
    if (problems.length > 0) {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_UNBALANCED, {
        message: `Écriture non créée car ${problems.join(' et ')}. Vérifiez/corrigez les données extraites avant de créer l'écriture.`,
      });
    }

    const input: CreateEntryInput = {
      journalCode: proposal.journalCode,
      entryDate: proposal.entryDate,
      description: proposal.description,
      reference: proposal.reference,
      lines: proposal.lines.map((l) => ({
        accountCode: l.accountCode,
        debit: l.debit,
        credit: l.credit,
        description: l.description ?? null,
      })),
    };

    const entry = await this.entriesService.createDraft(organizationId, input, actorUserId, ctx);

    await this.entries.link({
      organizationId,
      documentId,
      entryIds: [entry.id],
      createdBy: actorUserId,
    });

    await this.audit.record({
      module: DocumentsService.MODULE,
      action: 'linked_entry',
      entityType: DocumentsService.ENTITY_TYPE,
      entityId: documentId,
      after: { entryIds: [entry.id] },
      metadata: { entryCount: 1, source: 'create-entry-from-ocr', journalEntryNumber: entry.entryNumber },
      ctx: { ...ctx, userId: actorUserId, organizationId },
      legacyEventType: 'documents.linked_entry',
    });

    return { entry, documentId, warnings: proposal.warnings };
  }

  /**
   * Rebuild the purchase proposal from a document's `extracted_metadata`.
   * Prefers the rich `invoice` object (so overrides re-apply); falls back
   * to a previously stored `proposedEntry`. Returns null when neither is
   * present (document not OCR-processed, or OCR found nothing).
   */
  private buildProposalFromMetadata(
    metadata: Record<string, unknown> | null,
    overrides: ProposalOptions,
  ): ProposedEntry | null {
    if (metadata === null) return null;
    const invoice = metadata.invoice;
    if (invoice !== null && typeof invoice === 'object') {
      return buildPurchaseEntryProposal(invoice as ExtractedInvoice, overrides);
    }
    const stored = metadata.proposedEntry;
    if (stored !== null && typeof stored === 'object') {
      return stored as ProposedEntry;
    }
    return null;
  }

  /**
   * OCR + metadata extraction pipeline. Pulls the bytes from storage
   * into a temp file (so the provider receives a stable filesystem
   * path), invokes the OCR provider, persists the result + the regex-
   * extracted metadata. Best-effort — any failure leaves the document
   * with the prior OCR state and is logged at WARN.
   */
  private async runOcrPipeline(
    documentId: string,
    organizationId: TenantId,
    storageKey: string,
    mimeType: string,
  ): Promise<void> {
    let tmpPath: string | null = null;
    try {
      tmpPath = await this.stageStorageBytesToTempFile(storageKey, mimeType);
      const result = await this.ocrProvider.extract(tmpPath, mimeType);
      if (result === null) {
        // Provider declined to process — mark as skipped. On persiste en
        // prime un diagnostic du moteur OCR pour que l'UI explique POURQUOI
        // (dépendance absente, rasterisation KO, Space injoignable) sans
        // accès aux logs. Best-effort : un diagnostic en échec ne doit pas
        // empêcher le marquage `skipped`.
        let skipMetadata: Record<string, unknown> | null = null;
        try {
          const diagnostics = (await this.ocrProvider.diagnose?.()) ?? null;
          if (diagnostics !== null) {
            skipMetadata = { ocrSkip: diagnostics };
          }
        } catch {
          skipMetadata = null;
        }
        await this.documents.updateOcrResult(organizationId, documentId, {
          ocrStatus: 'skipped',
          ocrProcessedAt: new Date(),
          extractedMetadata: skipMetadata,
        });
        return;
      }

      // Quick canonical fields (back-compat top-level keys) + the rich
      // structured invoice (full header, lines, totals) + a proposed
      // SYSCOHADA purchase entry. All persisted in the `extracted_metadata`
      // jsonb column; the proposal is a suggestion the UI can turn into a
      // journal entry (charge account flagged for user confirmation).
      const metadata = extractInvoiceMetadata(result.text);
      let extractedMetadata: Record<string, unknown> | null = null;
      if (result.text.trim().length > 0) {
        const invoice = extractInvoice(result.text);
        const proposedEntry = buildPurchaseEntryProposal(invoice);
        extractedMetadata = { ...metadata, invoice, proposedEntry };
      } else if (Object.keys(metadata).length > 0) {
        extractedMetadata = metadata;
      }

      await this.documents.updateOcrResult(organizationId, documentId, {
        ocrStatus: 'processed',
        ocrText: result.text,
        ocrConfidence: result.confidence,
        ocrProcessedAt: new Date(),
        extractedMetadata,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `runOcrPipeline: failed for document ${documentId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.documents
        .updateOcrResult(organizationId, documentId, {
          ocrStatus: 'failed',
          ocrProcessedAt: new Date(),
        })
        .catch((updateError: unknown) => {
          this.logger.warn(
            `runOcrPipeline: failed to mark ocr_status=failed for ${documentId}: ${
              updateError instanceof Error ? updateError.message : String(updateError)
            }`,
          );
        });
    } finally {
      if (tmpPath !== null) {
        await fs.unlink(tmpPath).catch(() => undefined);
      }
    }
  }

  /**
   * Stream the storage bytes into a temp file on local disk so the
   * OCR provider receives a stable `filePath`. The caller is
   * responsible for unlinking the temp file once the OCR run is done.
   */
  private async stageStorageBytesToTempFile(storageKey: string, mimeType: string): Promise<string> {
    const stream = await this.storage.getStream(storageKey);
    const ext = this.extensionForMime(mimeType);
    const tmpPath = path.join(
      os.tmpdir(),
      `doc-ocr-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
    );
    const chunks: Buffer[] = [];
    return new Promise<string>((resolve, reject) => {
      stream.on('data', (chunk: Buffer | string) => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });
      stream.on('error', reject);
      stream.on('end', () => {
        fs.writeFile(tmpPath, Buffer.concat(chunks))
          .then(() => resolve(tmpPath))
          .catch(reject);
      });
    });
  }

  private extensionForMime(mimeType: string): string {
    switch (mimeType) {
      case 'application/pdf':
        return '.pdf';
      case 'image/png':
        return '.png';
      case 'image/jpeg':
      case 'image/jpg':
        return '.jpg';
      case 'image/webp':
        return '.webp';
      case 'image/tiff':
        return '.tiff';
      case 'image/bmp':
        return '.bmp';
      default:
        return '.bin';
    }
  }

  async getForOrg(organizationId: TenantId, id: string): Promise<DocumentView> {
    const row = await this.documents.findById(organizationId, id);
    if (row === null) {
      throw new AppException(ERROR_CODES.DOC_NOT_FOUND, {
        message: 'Document not found',
      });
    }
    return this.toView(row);
  }

  /**
   * OCR result view for a single document: status, raw text, and the
   * structured `extracted_metadata` (canonical fields + rich `invoice`
   * + `proposedEntry`). Powers the OCR panel on the documents page.
   */
  async getOcrResult(
    organizationId: TenantId,
    id: string,
  ): Promise<{
    readonly ocrStatus: OcrStatus;
    readonly ocrText: string | null;
    readonly extractedMetadata: Record<string, unknown> | null;
  }> {
    const row = await this.documents.findById(organizationId, id);
    if (row === null) {
      throw new AppException(ERROR_CODES.DOC_NOT_FOUND, { message: 'Document not found' });
    }
    return {
      ocrStatus: row.ocrStatus,
      ocrText: row.ocrText,
      extractedMetadata: row.extractedMetadata,
    };
  }

  /**
   * Relance manuelle du pipeline OCR sur une pièce déjà stockée.
   *
   * Cas d'usage : un PDF passé en `skipped` (la rasterisation n'était pas
   * disponible au moment de l'upload — dépendance `pdf-to-img` absente ou
   * Space PaddleOCR injoignable) ou un `failed` (timeout transitoire du
   * moteur). On retraite la pièce sans la ré-uploader.
   *
   * Le statut repasse à `processing` immédiatement, puis le pipeline est
   * relancé en fire-and-forget : PaddleOCR-VL peut prendre jusqu'à ~120 s
   * sur un cold-start ZeroGPU, on ne bloque donc pas la requête HTTP. Le
   * client suit l'avancée via `GET /documents/:id/ocr`.
   *
   * Idempotent : si un retraitement est déjà en cours (`processing`), on
   * ne lance pas un second pipeline concurrent sur la même pièce.
   */
  async retryOcr(
    organizationId: TenantId,
    id: string,
  ): Promise<{ readonly ocrStatus: OcrStatus }> {
    const row = await this.documents.findById(organizationId, id);
    if (row === null) {
      throw new AppException(ERROR_CODES.DOC_NOT_FOUND, { message: 'Document not found' });
    }
    if (row.ocrStatus === 'processing') {
      return { ocrStatus: 'processing' };
    }

    await this.documents.updateOcrResult(organizationId, id, {
      ocrStatus: 'processing',
      ocrProcessedAt: null,
    });

    this.runOcrPipeline(id, organizationId, row.storageKey, row.mimeType).catch(
      (error: unknown) => {
        this.logger.warn(
          `retryOcr: OCR pipeline failed for document ${id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      },
    );

    return { ocrStatus: 'processing' };
  }

  /**
   * Self-test du moteur OCR actif : état des dépendances optionnelles et,
   * pour le provider PaddleOCR, un test de rasterisation PDF. Permet de
   * diagnostiquer en prod pourquoi un PDF tombe en « OCR ignoré » sans
   * accès aux logs. Délègue au provider s'il expose `diagnose()`.
   */
  async diagnoseOcr(): Promise<OcrDiagnostics> {
    if (typeof this.ocrProvider.diagnose === 'function') {
      return this.ocrProvider.diagnose();
    }
    return {
      engine: process.env.OCR_ENGINE?.trim() || '(défaut/legacy)',
      checks: [
        {
          name: 'provider',
          ok: true,
          detail: 'moteur sans self-test (Tesseract/Null) — pas de rasterisation PDF',
        },
      ],
    };
  }

  /**
   * Returns the binary stream alongside the metadata the controller
   * needs to write the response headers (filename, content type).
   * Translates a storage-level miss into `DOC_NOT_FOUND` so a row
   * with a stale `storage_key` (e.g. partially-restored backup) still
   * surfaces a clean 404 to the caller.
   */
  async openStreamForOrg(
    organizationId: TenantId,
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
    organizationId: TenantId,
    filters: DocumentListFilters,
    pagination: PaginationOptions,
  ): Promise<ListDocumentsResult> {
    const { rows, total } = await this.documents.listForOrg(organizationId, filters, pagination);
    // Batched link count for the page (≤ pageSize ids) — one GROUP BY
    // query, no N+1. Unlinked documents default to 0.
    const linkCounts = await this.entries.countForDocuments(
      organizationId,
      rows.map((row) => row.id),
    );
    return {
      rows: rows.map((row) => this.toView(row, linkCounts.get(row.id) ?? 0)),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  }

  async softDelete(
    organizationId: TenantId,
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
      legacyEventType: 'documents.deleted',
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private toView(row: DocumentEntity, linkedEntryCount?: number): DocumentView {
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
      // `undefined` on single-document reads (omitted from JSON); a
      // concrete number (0..n) on the list path.
      linkedEntryCount,
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
