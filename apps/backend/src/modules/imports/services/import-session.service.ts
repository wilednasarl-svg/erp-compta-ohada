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
import type { ImportSourceType, ValidationError } from '../types/import-status';
import type { MappedRow, TargetField } from '../types/mapping';
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
    },
    actorUserId: string,
    ctx: AuditContext,
  ): Promise<SessionSummary> {
    const session = await this.sessions.create({
      organizationId,
      sourceType: input.sourceType,
      label: input.label ?? null,
      companyId: input.companyId ?? null,
      fiscalYear: input.fiscalYear ?? null,
      createdById: actorUserId,
    });

    await this.audit.record({
      module: ImportSessionService.MODULE,
      action: 'session_created',
      entityType: 'import_session',
      entityId: session.id,
      after: { sourceType: session.sourceType, label: session.label },
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
          await this.stagingEntries.bulkInsert(batch);
          batch = [];
        }
      }
      if (batch.length > 0) {
        await this.stagingEntries.bulkInsert(batch);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown parsing error';
      await this.files.updateStatus(fileId, organizationId, 'parse_failed', message);
      await this.sessions.markFailed(sessionId, organizationId, message);
      await this.audit.record({
        module: ImportSessionService.MODULE,
        action: 'session_failed',
        entityType: 'import_session',
        entityId: sessionId,
        metadata: { reason: 'parse_failed', message },
        ctx: { ...ctx, userId: actorUserId, organizationId },
        legacyEventType: 'imports.session_failed',
      });
      throw err;
    }

    await this.files.updateStatus(fileId, organizationId, 'parsed');
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

    // Re-parse just enough to recover the canonical header list — we
    // need the full set of headers for the auto-mapping proposal even
    // if the user only previews 50 rows. Limited to one file (MVP).
    const firstFile = sessionFiles[0];
    const { result } = await this.parser.parse(this.resolveAbsolutePath(firstFile.storagePath), {
      mimeType: firstFile.mimeType,
      originalName: firstFile.originalName,
    });
    // Drain the row iterator without storing — we already have staging
    // rows in DB, we just need to free the underlying file descriptor.
    // The CSV/XLSX drivers attach listeners that keep the process busy
    // until the iterator finishes.
    for await (const _ of result.rows) {
      // no-op
    }

    const proposal = this.mapping.autoMap(result.headers);

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

    const totals = await this.stagingEntries.countBySession(sessionId, organizationId);

    // Update counters + status with the latest pass.
    const errorLines = entries.reduce((acc, e) => acc + (e.errors.length > 0 ? 1 : 0), 0);
    await this.sessions.updateCounters(sessionId, organizationId, {
      totalLines: totals.total,
      errorLines,
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
        errorLines,
        unmappedTargets: proposal.unmappedTargets,
      },
      ctx: { ...ctx, userId: actorUserId, organizationId },
      legacyEventType: 'imports.preview_generated',
    });

    const refreshed = await this.sessions.findById(sessionId, organizationId);
    return {
      session: this.toSummary(refreshed ?? session),
      headers: result.headers,
      headerMapping: proposal.headerToTarget,
      unmappedTargets: proposal.unmappedTargets,
      totals: { total: totals.total, withErrors: errorLines },
      entries,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private toSummary(s: ImportSessionEntity): SessionSummary {
    return {
      id: s.id,
      status: s.status,
      sourceType: s.sourceType,
      label: s.label,
      totalLines: s.totalLines,
      errorLines: s.errorLines,
      createdAt: s.createdAt,
    };
  }

  private resolveAbsolutePath(relativePath: string): string {
    const root = this.config.get('imports', { infer: true }).storageDir;
    return path.resolve(root, relativePath);
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
}
