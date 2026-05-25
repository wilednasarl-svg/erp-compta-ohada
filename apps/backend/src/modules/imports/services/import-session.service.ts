import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { AppConfig } from '../../../config/configuration';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { OrganizationAccountRepository } from '../../accounting-plan/repositories/organization-account.repository';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import type { ImportSessionEntity } from '../entities/import-session.entity';
import { ImportFileRepository } from '../repositories/import-file.repository';
import { ImportSessionRepository } from '../repositories/import-session.repository';
import { ImportStagingEntryRepository } from '../repositories/import-staging-entry.repository';
import {
  DOCUMENT_TYPE_OVERRIDE_KEY,
  type DocumentType,
  type ImportSourceType,
  type ValidationError,
} from '../types/import-status';

export interface CommitResult {
  readonly sessionId: string;
  readonly committedRows: number;
  readonly entryIds: readonly string[];
}

/**
 * Internal: one staging row projected to the shape we feed to
 * `EntriesService.createDraft`. Built during the pre-validation phase
 * so any parse / mapping error is surfaced before any DB write.
 */
interface StagingLineDraft {
  readonly rowNumber: number;
  readonly journalCode: string;
  readonly entryDate: string;
  readonly accountCode: string;
  readonly label: string;
  readonly debit: number;
  readonly credit: number;
  readonly partner: string | null;
}
import type { MappedRow, TargetField } from '../types/mapping';
import { EntriesService, type CreateLineInput } from '../../journals/services/entries.service';
import { FileParserService } from './file-parser.service';
import { MappingService } from './mapping.service';
import { ValidationService } from './validation.service';

/**
 * Représentation minimale d'un fichier reçu en upload, agnostique du
 * framework HTTP (Multer côté contrôleur, n'importe quoi côté test).
 */
export interface UploadFileInput {
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly content: NodeJS.ReadableStream;
}

export interface SessionSummary {
  readonly id: string;
  readonly status: ImportSessionEntity['status'];
  readonly sourceType: ImportSourceType;
  readonly label: string | null;
  readonly totalLines: number;
  readonly errorLines: number;
  readonly createdAt: Date;
  readonly documentType: DocumentType | null;
}

export interface PreviewEntry {
  readonly rowNumber: number;
  readonly rawValues: Record<string, string | null>;
  readonly mappedValues: MappedRow;
  readonly errors: ValidationError[];
}

export interface PreviewResult {
  readonly session: SessionSummary;
  readonly headers: readonly string[];
  readonly headerMapping: Record<string, TargetField>;
  readonly unmappedTargets: readonly TargetField[];
  readonly totals: { total: number; withErrors: number };
  readonly entries: readonly PreviewEntry[];
}

/**
 * `ImportSessionService` — orchestre le cycle de vie d'une session
 * d'import : création, upload de fichier (avec checksum + stockage
 * disque), parsing, mapping, validation et génération de preview.
 *
 * Contraintes appliquées :
 *
 *   - tenant scope : `organizationId` (`TenantId`) sur chaque méthode
 *     publique, transmis aux repos qui re-vérifient via `assertTenantId`.
 *   - taille max upload : configurée via `IMPORT_MAX_FILE_SIZE_MB`.
 *     Vérifiée AVANT écriture disque (header `Content-Length`) ET
 *     après (`fs.stat`) pour bloquer un client qui mentirait sur
 *     `Content-Length`.
 *   - format autorisé : déterminé par `FileParserService.resolve` —
 *     un format non géré lève `IMPORT_UNSUPPORTED_FORMAT` AVANT
 *     écriture disque.
 *   - statuts pipeline : `draft → parsing → parsed → validated`. La
 *     preview ne peut être (re)générée que sur une session déjà parsée.
 *   - audit append-only : chaque étape (create, upload, parse,
 *     preview, failure) est journalisée via `AuditTrailService` —
 *     swallow-and-warn, jamais bloquant.
 *
 * Non implémenté en MVP (Module 3 vague 1) :
 *   - le passage `validated → ready_for_import → completed` (commit
 *     vers les tables comptables réelles) — arrive en vague 2.
 *   - le re-mapping après edit utilisateur — la preview MVP utilise
 *     toujours l'auto-mapping ; l'override viendra avec l'UI dédiée.
 */
@Injectable()
export class ImportSessionService {
  private static readonly MODULE = 'imports' as const;

  constructor(
    private readonly sessions: ImportSessionRepository,
    private readonly files: ImportFileRepository,
    private readonly stagingEntries: ImportStagingEntryRepository,
    private readonly parser: FileParserService,
    private readonly mapping: MappingService,
    private readonly validation: ValidationService,
    private readonly chartAccounts: OrganizationAccountRepository,
    private readonly entries: EntriesService,
    private readonly audit: AuditTrailService,
    @Inject(ConfigService) private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // ─── Create session ─────────────────────────────────────────────────

  async createSession(
    organizationId: TenantId,
    input: {
      sourceType: ImportSourceType;
      label?: string | null;
      companyId?: string | null;
      fiscalYear?: string | null;
      documentType?: DocumentType | null;
    },
    actorUserId: string,
    ctx: AuditContext,
  ): Promise<SessionSummary> {
    // Le documentType est stocké dans le JSONB `mapping_override` sous
    // la clé sentinelle `__documentType` pour éviter une migration SQL.
    // Le MappingService extrait cette clé avant de traiter les
    // overrides de header — voir `MappingService.extractDocumentType`.
    const initialOverride: Record<string, string> | null =
      input.documentType !== null && input.documentType !== undefined
        ? { [DOCUMENT_TYPE_OVERRIDE_KEY]: input.documentType }
        : null;

    const session = await this.sessions.create({
      organizationId,
      sourceType: input.sourceType,
      label: input.label ?? null,
      companyId: input.companyId ?? null,
      fiscalYear: input.fiscalYear ?? null,
      mappingOverride: initialOverride,
      createdById: actorUserId,
    });

    await this.audit.record({
      module: ImportSessionService.MODULE,
      action: 'session_created',
      entityType: 'import_session',
      entityId: session.id,
      after: {
        sourceType: session.sourceType,
        label: session.label,
        documentType: input.documentType ?? null,
      },
      ctx: { ...ctx, userId: actorUserId, organizationId },
      legacyEventType: 'imports.session_created',
    });

    return this.toSummary(session);
  }

  async listSessions(
    organizationId: TenantId,
    options: { status?: ImportSessionEntity['status']; limit?: number } = {},
  ): Promise<SessionSummary[]> {
    const rows = await this.sessions.listByOrganization(organizationId, options);
    return rows.map((r) => this.toSummary(r));
  }

  async getSession(organizationId: TenantId, sessionId: string): Promise<SessionSummary> {
    const session = await this.sessions.findById(sessionId, organizationId);
    if (session === null) {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_FOUND);
    }
    return this.toSummary(session);
  }

  // ─── Upload + parse file ────────────────────────────────────────────

  async uploadFile(
    organizationId: TenantId,
    sessionId: string,
    upload: UploadFileInput,
    actorUserId: string,
    ctx: AuditContext,
  ): Promise<{ fileId: string }> {
    const session = await this.sessions.findById(sessionId, organizationId);
    if (session === null) {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_FOUND);
    }
    if (session.status !== 'draft') {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_DRAFT, {
        message: `Session status is "${session.status}", upload allowed only on draft`,
      });
    }

    const maxBytes = this.config.get('imports', { infer: true }).maxFileSizeBytes;
    if (upload.sizeBytes > maxBytes) {
      throw new AppException(ERROR_CODES.IMPORT_FILE_TOO_LARGE, {
        message: `File exceeds the configured limit (${Math.round(maxBytes / 1024 / 1024)} MB)`,
        details: { sizeBytes: upload.sizeBytes, maxBytes },
      });
    }

    // Resolve parser BEFORE writing bytes — rejects unsupported format
    // without leaving a half-written file on disk.
    this.parser.resolve({ mimeType: upload.mimeType, originalName: upload.originalName });

    const { absolutePath, relativePath, sha256, actualSize } = await this.persistFileToDisk(
      organizationId,
      sessionId,
      upload,
      maxBytes,
    );

    // Detect duplicate by checksum within the same session — uploading
    // the same bytes twice is wasteful and almost always a user mistake.
    const existingDuplicate = await this.files.findByChecksumInSession(
      sessionId,
      sha256,
      organizationId,
    );
    if (existingDuplicate !== null) {
      await rm(absolutePath, { force: true });
      throw new AppException(ERROR_CODES.IMPORT_FILE_DUPLICATE, {
        message: 'A file with the same checksum already exists in this session',
        details: { existingFileId: existingDuplicate.id },
      });
    }

    const file = await this.files.create({
      sessionId,
      originalName: upload.originalName,
      mimeType: upload.mimeType,
      sizeBytes: actualSize,
      sha256Checksum: sha256,
      storagePath: relativePath,
      uploadedById: actorUserId,
    });

    await this.audit.record({
      module: ImportSessionService.MODULE,
      action: 'file_uploaded',
      entityType: 'import_file',
      entityId: file.id,
      after: {
        sessionId,
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: actualSize,
        sha256: sha256.slice(0, 12),
      },
      ctx: { ...ctx, userId: actorUserId, organizationId },
      legacyEventType: 'imports.file_uploaded',
    });

    return { fileId: file.id };
  }

  /**
   * Lance le parsing du fichier déjà uploadé : crée les `staging_entries`
   * brutes (sans mapping ni validation). Statut session : `parsing → parsed`.
   *
   * Séparé de `uploadFile` pour deux raisons :
   *   - permettre une re-upload + parse multi-fichier plus tard sans
   *     redéfinir le contrat HTTP,
   *   - laisser la place à une exécution asynchrone (queue) en vague 2
   *     sans casser l'API actuelle.
   */
  async parseFile(
    organizationId: TenantId,
    sessionId: string,
    fileId: string,
    actorUserId: string,
    ctx: AuditContext,
  ): Promise<{ rowsParsed: number; headers: readonly string[] }> {
    const session = await this.sessions.findById(sessionId, organizationId);
    if (session === null) {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_FOUND);
    }
    const file = await this.files.findById(fileId, organizationId);
    if (file === null || file.sessionId !== sessionId) {
      throw new AppException(ERROR_CODES.IMPORT_FILE_NOT_FOUND);
    }
    if (file.status !== 'uploaded') {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_DRAFT, {
        message: `File status is "${file.status}", parse allowed only on uploaded`,
      });
    }

    const absolutePath = this.resolveAbsolutePath(file.storagePath);
    await this.files.updateStatus(fileId, organizationId, 'parsing');
    await this.sessions.updateStatus(sessionId, organizationId, 'parsing');

    let totalRows = 0;
    let detectedHeaders: readonly string[] = [];

    try {
      const { result } = await this.parser.parse(absolutePath, {
        mimeType: file.mimeType,
        originalName: file.originalName,
      });
      detectedHeaders = result.headers;

      // Streaming-aware batching: flush every 500 rows so a 50k-line
      // file produces 100 INSERTs (manageable for the pooler) and RAM
      // stays bounded.
      const BATCH_SIZE = 500;
      let batch: Array<{
        sessionId: string;
        fileId: string;
        rowNumber: number;
        rawValues: Record<string, string | null>;
        mappedValues: MappedRow;
        errors: ValidationError[];
      }> = [];

      for await (const row of result.rows) {
        batch.push({
          sessionId,
          fileId,
          rowNumber: row.rowNumber,
          rawValues: row.values,
          mappedValues: {},
          errors: [],
        });
        totalRows += 1;
        if (batch.length >= BATCH_SIZE) {
          await this.stagingEntries.bulkInsert(organizationId, batch);
          batch = [];
        }
      }
      if (batch.length > 0) {
        await this.stagingEntries.bulkInsert(organizationId, batch);
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : 'Unknown parsing error';
      const message = ImportSessionService.sanitizeErrorMessage(rawMessage);
      await this.files.updateStatus(fileId, organizationId, 'parse_failed', message);
      await this.sessions.markFailed(sessionId, organizationId, message);
      await this.audit.record({
        module: ImportSessionService.MODULE,
        action: 'session_failed',
        entityType: 'import_session',
        entityId: sessionId,
        metadata: {
          reason: 'parse_failed',
          message,
          rawMessage: err instanceof Error ? err.message : String(err),
        },
        ctx: { ...ctx, userId: actorUserId, organizationId },
        legacyEventType: 'imports.session_failed',
      });
      throw err;
    }

    await this.files.updateStatus(fileId, organizationId, 'parsed');
    // Fix projet-ferme-7lr: persist headers so preview() can read them
    // from DB instead of re-opening the file.
    await this.files.updateDetectedHeaders(fileId, organizationId, detectedHeaders);
    await this.sessions.updateStatus(sessionId, organizationId, 'parsed');
    await this.sessions.updateCounters(sessionId, organizationId, {
      totalLines: totalRows,
      errorLines: 0,
    });

    await this.audit.record({
      module: ImportSessionService.MODULE,
      action: 'file_parsed',
      entityType: 'import_file',
      entityId: fileId,
      after: { rowsParsed: totalRows, headerCount: detectedHeaders.length },
      ctx: { ...ctx, userId: actorUserId, organizationId },
      legacyEventType: 'imports.file_parsed',
    });

    return { rowsParsed: totalRows, headers: detectedHeaders };
  }

  // ─── Preview ────────────────────────────────────────────────────────

  async preview(
    organizationId: TenantId,
    sessionId: string,
    actorUserId: string,
    ctx: AuditContext,
    options: { limit?: number; offset?: number } = {},
  ): Promise<PreviewResult> {
    const session = await this.sessions.findById(sessionId, organizationId);
    if (session === null) {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_FOUND);
    }
    if (session.status === 'draft' || session.status === 'parsing') {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_PARSED, {
        message: `Session must be parsed before preview (current status: ${session.status})`,
      });
    }

    const sessionFiles = await this.files.listBySession(sessionId, organizationId);
    if (sessionFiles.length === 0) {
      throw new AppException(ERROR_CODES.IMPORT_FILE_NOT_FOUND);
    }

    // Fix projet-ferme-7lr: read cached headers from DB instead of
    // re-opening and re-parsing the entire file. Fallback to re-parse
    // only for legacy files parsed before migration 0035.
    const firstFile = sessionFiles[0];
    let headers: readonly string[];

    if (firstFile.detectedHeaders && firstFile.detectedHeaders.length > 0) {
      headers = firstFile.detectedHeaders;
    } else {
      // Legacy fallback — file was parsed before the detectedHeaders
      // column existed. Re-parse to recover headers.
      const { result } = await this.parser.parse(this.resolveAbsolutePath(firstFile.storagePath), {
        mimeType: firstFile.mimeType,
        originalName: firstFile.originalName,
      });
      for await (const _ of result.rows) {
        // Drain to free the file descriptor.
      }
      headers = result.headers;
      // Backfill the column so future previews skip re-parse.
      await this.files.updateDetectedHeaders(firstFile.id, organizationId, headers);
    }

    // Échantillon pour la détection par contenu : on charge les ~50
    // premières lignes en plus de la page demandée, pour que l'auto-
    // mapping puisse sniffer les valeurs même si l'utilisateur consulte
    // la page 2/3/N (où les rows demandées ne couvrent plus le début
    // du fichier). Coût négligeable (limit 50, scope tenant déjà
    // appliqué dans le repo).
    const sniffSample = await this.stagingEntries.listBySession(sessionId, organizationId, {
      limit: 50,
      offset: 0,
    });

    // Extraire le documentType du JSONB (clé sentinelle) et purifier
    // les overrides pour ne laisser que des mappings header → target.
    const rawOverride = (session.mappingOverride as Record<string, string>) ?? {};
    const documentType = (rawOverride[DOCUMENT_TYPE_OVERRIDE_KEY] as DocumentType | undefined) ?? null;
    const headerOverrides: Record<string, TargetField> = {};
    for (const [k, v] of Object.entries(rawOverride)) {
      if (k === DOCUMENT_TYPE_OVERRIDE_KEY) continue;
      headerOverrides[k] = v as TargetField;
    }

    const proposal = this.mapping.autoMap(
      headers,
      headerOverrides,
      sniffSample.map((r) => r.rawValues),
      documentType,
    );

    // Build chart index for validation. Loaded fresh on each preview
    // so account additions / deactivations are picked up immediately.
    const accounts = await this.chartAccounts.listByOrganization(organizationId, {
      activeOnly: true,
    });
    const chart = this.validation.buildChartIndex(
      accounts.map((a) => ({
        code: a.code,
        accountType: a.accountType,
        isActive: a.isActive,
      })),
    );

    const stagingRows = await this.stagingEntries.listBySession(sessionId, organizationId, {
      limit: options.limit ?? 100,
      offset: options.offset ?? 0,
    });

    const entries: PreviewEntry[] = stagingRows.map((row) => {
      const mapped = this.mapping.applyMapping(row.rawValues, proposal.headerToTarget);
      const errors = this.validation.validateRow(mapped, { chart });
      return {
        rowNumber: row.rowNumber,
        rawValues: row.rawValues,
        mappedValues: mapped,
        errors,
      };
    });

    // Fix projet-ferme-7kn: persist mapped values + validation errors
    // back to the staging rows so that SQL-level `countBySession` (which
    // counts `jsonb_array_length(errors) > 0`) is accurate across ALL
    // rows, not just the current preview page.
    await this.stagingEntries.updateMappedValuesAndErrors(
      stagingRows.map((row, idx) => ({
        id: row.id,
        mappedValues: entries[idx].mappedValues,
        errors: entries[idx].errors,
      })),
    );

    // Re-count AFTER the staging update so `withErrors` reflects the
    // freshly-written validation findings.
    const totals = await this.stagingEntries.countBySession(sessionId, organizationId);

    // Use the SQL-level count — not a page-local reduce — so the
    // session counter covers every row in the file. (Previous code
    // only counted errors within the visible page, capped at ~100.)
    await this.sessions.updateCounters(sessionId, organizationId, {
      totalLines: totals.total,
      errorLines: totals.withErrors,
    });
    if (session.status === 'parsed') {
      await this.sessions.updateStatus(sessionId, organizationId, 'validated');
    }

    await this.audit.record({
      module: ImportSessionService.MODULE,
      action: 'preview_generated',
      entityType: 'import_session',
      entityId: sessionId,
      metadata: {
        previewSize: entries.length,
        totalLines: totals.total,
        errorLines: totals.withErrors,
        unmappedTargets: proposal.unmappedTargets,
      },
      ctx: { ...ctx, userId: actorUserId, organizationId },
      legacyEventType: 'imports.preview_generated',
    });

    const refreshed = await this.sessions.findById(sessionId, organizationId);
    return {
      session: this.toSummary(refreshed ?? session),
      headers,
      headerMapping: proposal.headerToTarget,
      unmappedTargets: proposal.unmappedTargets,
      totals: { total: totals.total, withErrors: totals.withErrors },
      entries,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private toSummary(s: ImportSessionEntity): SessionSummary {
    const docType = s.mappingOverride?.[DOCUMENT_TYPE_OVERRIDE_KEY] ?? null;
    return {
      id: s.id,
      status: s.status,
      sourceType: s.sourceType,
      label: s.label,
      totalLines: s.totalLines,
      errorLines: s.errorLines,
      createdAt: s.createdAt,
      documentType: (docType as DocumentType | null) ?? null,
    };
  }

  /**
   * Resolve a stored `relativePath` (from `import_files.storage_path`)
   * to an absolute disk path, refusing any value that escapes the
   * imports storage root.
   *
   * Defense (audit Module 3 Sec-H3): even though the write path
   * sanitises filenames, the `storage_path` column is reachable from
   * other angles (SQL injection elsewhere, untrusted backup restore,
   * insider DB edit). Without `startsWith(root + sep)` after
   * `path.resolve`, a tampered row could cause `parseFile` /
   * `preview` to open arbitrary server paths. `DOC_NOT_FOUND`-style
   * indistinguishability is intentional — same code path as a missing
   * file from the caller's perspective.
   */
  private resolveAbsolutePath(relativePath: string): string {
    const root = this.config.get('imports', { infer: true }).storageDir;
    const rootResolved = path.resolve(root);
    const absolute = path.resolve(rootResolved, relativePath);
    if (absolute !== rootResolved && !absolute.startsWith(rootResolved + path.sep)) {
      throw new AppException(ERROR_CODES.IMPORT_FILE_NOT_FOUND, {
        message: 'Import file not found',
      });
    }
    return absolute;
  }

  /**
   * Écrit le flux sur disque tout en (a) hashant le contenu en SHA-256
   * en streaming, (b) bornant la taille à `maxBytes` même si le client
   * a menti sur `Content-Length`. Si la limite est dépassée, le fichier
   * partiel est supprimé et l'erreur métier remonte.
   *
   * Le chemin de stockage est isolé par org (`<storageDir>/<orgId>/<sessionId>/<uuid>-<originalName>`)
   * de sorte qu'un futur opérateur ne puisse pas accidentellement
   * mélanger les fichiers de deux clients via une commande shell.
   */
  private async persistFileToDisk(
    organizationId: TenantId,
    sessionId: string,
    upload: UploadFileInput,
    maxBytes: number,
  ): Promise<{
    absolutePath: string;
    relativePath: string;
    sha256: string;
    actualSize: number;
  }> {
    const root = this.config.get('imports', { infer: true }).storageDir;
    const safeName = upload.originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${Date.now()}-${safeName}`;
    const relativeDir = path.posix.join(organizationId, sessionId);
    const relativePath = path.posix.join(relativeDir, filename);
    const absoluteDir = path.resolve(root, relativeDir);
    const absolutePath = path.resolve(root, relativePath);

    await mkdir(absoluteDir, { recursive: true });

    const hash = createHash('sha256');
    let written = 0;
    let oversized = false;

    const sizeGuard = new Transform({
      transform(
        chunk: Buffer,
        _enc: BufferEncoding,
        cb: (err?: Error | null, data?: Buffer) => void,
      ) {
        written += chunk.length;
        if (written > maxBytes) {
          oversized = true;
          cb(new Error('OVERSIZED'));
          return;
        }
        hash.update(chunk);
        cb(null, chunk);
      },
    });

    try {
      await pipeline(upload.content, sizeGuard, createWriteStream(absolutePath));
    } catch (err) {
      await rm(absolutePath, { force: true });
      if (oversized) {
        throw new AppException(ERROR_CODES.IMPORT_FILE_TOO_LARGE, {
          message: `Upload exceeded the configured limit (${Math.round(maxBytes / 1024 / 1024)} MB)`,
        });
      }
      throw new AppException(ERROR_CODES.IMPORT_FILE_PARSE_FAILED, {
        message: 'Failed to persist uploaded file',
        cause: err,
      });
    }

    const statResult = await stat(absolutePath);
    if (statResult.size > maxBytes) {
      await rm(absolutePath, { force: true });
      throw new AppException(ERROR_CODES.IMPORT_FILE_TOO_LARGE, {
        message: `Upload exceeded the configured limit (${Math.round(maxBytes / 1024 / 1024)} MB)`,
      });
    }

    return {
      absolutePath,
      relativePath,
      sha256: hash.digest('hex'),
      actualSize: statResult.size,
    };
  }

  // ─── Commit ─────────────────────────────────────────────────────────

  /**
   * Module 3 wave 2 — commit a validated session into real accounting
   * entries (Module 8).
   *
   * Pipeline:
   *   1. Verify session exists + belongs to org + status is `validated`.
   *   2. Count staging entries with non-empty `errors` — refuse with
   *      `IMPORT_SESSION_NOT_VALID` so the user fixes them first.
   *   3. Load ALL clean staging rows for the session.
   *   4. Pre-validate the projection: parse amounts / dates / journal
   *      code / account code, group by `(journalCode, entryDate)` and
   *      verify each group balances (sum debit == sum credit).
   *      Surface a single `IMPORT_COMMIT_UNBALANCED_GROUP` listing every
   *      bad group so the user can fix in one pass.
   *   5. Transition `validated → ready_for_import` (atomic gate vs.
   *      concurrent double-commit).
   *   6. For each group, call `EntriesService.createDraft` then
   *      `validate`. Track the created entryIds. On unexpected failure
   *      (post-validation race), surface `IMPORT_COMMIT_FAILED` with
   *      the failed group + any already-committed entries listed so the
   *      operator can decide whether to roll back manually.
   *   7. Transition `ready_for_import → completed`.
   *   8. Emit `imports.session_committed` audit event with the entryIds.
   *
   * Idempotence: a `completed` session is detected early and the same
   * `{ sessionId, committedRows }` is returned without re-running the
   * write path. `entryIds` is empty in the idempotent return because
   * the originally-created entry IDs are not retained on the session
   * row in wave 2 — wave 3 will persist them as a backref.
   *
   * Grouping note: rows are grouped by `(journalCode, entryDate)` —
   * the import format has no piece reference field. `projet-ferme-l4g`
   * tracks adding a proper `reference` TargetField for per-piece
   * grouping; in the meantime a daily aggregate per journal is the
   * pragmatic MVP that still produces auditable balanced entries.
   */
  async commitSession(
    organizationId: TenantId,
    sessionId: string,
    actorUserId: string,
    ctx: AuditContext,
  ): Promise<CommitResult> {
    const session = await this.sessions.findById(sessionId, organizationId);
    if (session === null) {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_FOUND);
    }

    // Idempotence — already committed.
    if (session.status === 'completed') {
      const totals = await this.stagingEntries.countBySession(sessionId, organizationId);
      return { sessionId, committedRows: totals.total, entryIds: [] };
    }

    if (session.status !== 'validated') {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_PARSED, {
        message: `Session must be in 'validated' status to commit (current: ${session.status})`,
      });
    }

    const totals = await this.stagingEntries.countBySession(sessionId, organizationId);
    if (totals.withErrors > 0) {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_VALID, {
        message: `Cannot commit: ${totals.withErrors} row(s) still have validation errors`,
        details: { errorRows: totals.withErrors, totalRows: totals.total },
      });
    }

    // Step 3 — load every clean staging row (paginated to avoid the
    // default 100-row cap on listBySession).
    const rows = await this.loadAllStagingRows(sessionId, organizationId);
    if (rows.length === 0) {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_VALID, {
        message: 'Cannot commit an empty session (no staging rows).',
      });
    }

    // Step 4 — project + group + balance pre-check.
    const drafts: StagingLineDraft[] = rows.map((r) =>
      this.projectStagingRow(r.rowNumber, r.mappedValues),
    );
    const groups = this.groupByJournalAndDate(drafts);
    const unbalanced = this.collectUnbalancedGroups(groups);
    if (unbalanced.length > 0) {
      throw new AppException(ERROR_CODES.IMPORT_COMMIT_UNBALANCED_GROUP, {
        message: `${unbalanced.length} group(s) are unbalanced; the commit was aborted before any write.`,
        details: { groups: unbalanced },
      });
    }

    // Step 5 — atomic gate.
    await this.sessions.updateStatus(sessionId, organizationId, 'ready_for_import');

    // Step 6 — sequentially create + validate every entry. Each
    // `EntriesService.createDraft` opens its own transaction; the
    // pre-validation above means a runtime failure here is a true
    // race (e.g. period closed between steps 4 and 6).
    const committedEntryIds: string[] = [];
    try {
      for (const [key, group] of groups) {
        const lines: CreateLineInput[] = group.rows.map((row) => ({
          accountCode: row.accountCode,
          debit: row.debit,
          credit: row.credit,
          description: row.label,
        }));
        const draft = await this.entries.createDraft(
          organizationId,
          {
            journalCode: group.journalCode,
            entryDate: group.entryDate,
            description: `Import session ${sessionId} — ${group.journalCode} ${group.entryDate}`,
            reference: null,
            lines,
            sourceType: 'import',
            sourceImportSessionId: sessionId,
          },
          actorUserId,
          ctx,
        );
        await this.entries.validate(organizationId, draft.id, actorUserId, ctx);
        committedEntryIds.push(draft.id);
        // Best-effort: if a downstream user later wants the group key
        // back from telemetry, it lives in the audit metadata below.
        void key;
      }
    } catch (error: unknown) {
      // Partial commit: surface the failure and what was already
      // written. The session is left in `ready_for_import` so a human
      // can decide whether to roll the entries back or finish manually.
      throw new AppException(ERROR_CODES.IMPORT_COMMIT_FAILED, {
        message: 'Commit failed mid-way; some entries may have been written.',
        cause: error,
        details: {
          committedEntryIds,
          remainingGroups: groups.size - committedEntryIds.length,
        },
      });
    }

    // Step 7 — mark complete.
    await this.sessions.updateStatus(sessionId, organizationId, 'completed');

    // Step 8 — single aggregated audit event with the produced IDs.
    await this.audit.record({
      module: ImportSessionService.MODULE,
      action: 'session_committed',
      entityType: 'import_session',
      entityId: sessionId,
      after: {
        committedRows: totals.total,
        status: 'completed',
        entryIds: committedEntryIds,
        groups: committedEntryIds.length,
      },
      ctx: { ...ctx, userId: actorUserId, organizationId },
      legacyEventType: 'imports.session_committed',
    });

    return { sessionId, committedRows: totals.total, entryIds: committedEntryIds };
  }

  // ─── Commit helpers ─────────────────────────────────────────────────

  private async loadAllStagingRows(
    sessionId: string,
    organizationId: TenantId,
  ): Promise<Array<{ rowNumber: number; mappedValues: MappedRow }>> {
    const pageSize = 500;
    let offset = 0;
    const all: Array<{ rowNumber: number; mappedValues: MappedRow }> = [];
    // Loop until a page comes back smaller than pageSize — no terminal
    // total query so we don't double-count a concurrent insert (none
    // expected on a `validated` session, but defensive).
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await this.stagingEntries.listBySession(sessionId, organizationId, {
        limit: pageSize,
        offset,
      });
      for (const row of page) {
        all.push({ rowNumber: row.rowNumber, mappedValues: row.mappedValues });
      }
      if (page.length < pageSize) {
        break;
      }
      offset += pageSize;
    }
    return all;
  }

  /**
   * Project a single `mappedValues` row to the typed shape consumed by
   * the grouping + balance pre-check. ValidationService has already
   * proven the row well-formed before status reached `validated`, so
   * the parsing here is meant to surface a *programming* error rather
   * than a user data error (the throws below would indicate that
   * validation drift let an invalid row sneak through).
   */
  private projectStagingRow(rowNumber: number, mapped: MappedRow): StagingLineDraft {
    const journalCode = (mapped.journal ?? '').trim();
    const entryDate = (mapped.date ?? '').trim();
    const accountCode = (mapped.account ?? '').trim();
    const label = (mapped.label ?? '').trim();
    if (journalCode === '' || entryDate === '' || accountCode === '' || label === '') {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_VALID, {
        message: `Row ${rowNumber} is missing a required target field after mapping.`,
        details: { rowNumber, mapped },
      });
    }
    const debit = parseFloat((mapped.debit ?? '0').replace(/\s/g, '').replace(',', '.')) || 0;
    const credit = parseFloat((mapped.credit ?? '0').replace(/\s/g, '').replace(',', '.')) || 0;
    return {
      rowNumber,
      journalCode,
      entryDate,
      accountCode,
      label,
      debit,
      credit,
      partner: mapped.partner ?? null,
    };
  }

  private groupByJournalAndDate(
    drafts: readonly StagingLineDraft[],
  ): Map<string, { journalCode: string; entryDate: string; rows: StagingLineDraft[] }> {
    const groups = new Map<
      string,
      { journalCode: string; entryDate: string; rows: StagingLineDraft[] }
    >();
    for (const d of drafts) {
      const key = `${d.journalCode}|${d.entryDate}`;
      const bucket = groups.get(key);
      if (bucket === undefined) {
        groups.set(key, { journalCode: d.journalCode, entryDate: d.entryDate, rows: [d] });
      } else {
        bucket.rows.push(d);
      }
    }
    return groups;
  }

  private collectUnbalancedGroups(
    groups: ReadonlyMap<
      string,
      { journalCode: string; entryDate: string; rows: StagingLineDraft[] }
    >,
  ): Array<{
    journalCode: string;
    entryDate: string;
    totalDebit: number;
    totalCredit: number;
    rowCount: number;
  }> {
    const out: Array<{
      journalCode: string;
      entryDate: string;
      totalDebit: number;
      totalCredit: number;
      rowCount: number;
    }> = [];
    for (const group of groups.values()) {
      const totalDebit = group.rows.reduce((s, r) => s + r.debit, 0);
      const totalCredit = group.rows.reduce((s, r) => s + r.credit, 0);
      // Match EntriesService.createDraft tolerance (5 mille).
      if (Math.abs(totalDebit - totalCredit) > 0.005) {
        out.push({
          journalCode: group.journalCode,
          entryDate: group.entryDate,
          totalDebit: Math.round(totalDebit * 100) / 100,
          totalCredit: Math.round(totalCredit * 100) / 100,
          rowCount: group.rows.length,
        });
      }
    }
    return out;
  }

  // ─── Update Mapping ───────────────────────────────────────────────────

  async updateMappingOverride(
    organizationId: TenantId,
    sessionId: string,
    mappingOverride: Record<string, string>,
    actorUserId: string,
    ctx: AuditContext,
  ): Promise<void> {
    const session = await this.sessions.findById(sessionId, organizationId);
    if (session === null) {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_FOUND);
    }

    if (session.status !== 'parsed' && session.status !== 'validated') {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_PARSED, {
        message: `Session must be parsed or validated before mapping can be updated (current status: ${session.status})`,
      });
    }

    // Préserver le `__documentType` éventuellement présent dans l'override
    // existant — un update de mapping côté UI ne doit pas effacer la
    // nature du document choisie à la création.
    const existingDocType =
      session.mappingOverride?.[DOCUMENT_TYPE_OVERRIDE_KEY] ?? null;
    const merged: Record<string, string> = { ...mappingOverride };
    if (existingDocType !== null && merged[DOCUMENT_TYPE_OVERRIDE_KEY] === undefined) {
      merged[DOCUMENT_TYPE_OVERRIDE_KEY] = existingDocType;
    }

    await this.sessions.updateMappingOverride(sessionId, organizationId, merged);

    if (session.status === 'validated') {
      await this.sessions.updateStatus(sessionId, organizationId, 'parsed');
    }

    await this.audit.record({
      module: ImportSessionService.MODULE,
      action: 'mapping_override_updated',
      entityType: 'import_session',
      entityId: sessionId,
      after: { mappingOverride },
      ctx: { ...ctx, userId: actorUserId, organizationId },
      legacyEventType: 'imports.mapping_updated',
    });
  }

  /**
   * Strip absolute filesystem paths from a parser error message before
   * persisting to `failure_reason` and exposing via the API.
   *
   * Keeps the original message intact in audit log metadata (non-public).
   * Defense: audit Module 3 Sec-L1 — info disclosure via failure_reason.
   */
  static sanitizeErrorMessage(raw: string): string {
    // POSIX absolute paths: /foo/bar, /var/uploads/orgid/...
    // Windows absolute paths: C:\foo\bar or \\share\path
    const sanitized = raw
      .replace(/(?:[A-Za-z]:[/\\]|\/)[^\s"'<>{}|\\^[\]`]*[^\s"'<>{}|\\^[\]`.,;:]/g, '<path>')
      .slice(0, 500);
    return sanitized || 'Parsing error';
  }
}
