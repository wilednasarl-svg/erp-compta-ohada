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
import { ReferenceAccountRepository } from '../../accounting-plan/repositories/reference-account.repository';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import type { ImportSessionEntity } from '../entities/import-session.entity';
import { ImportFileRepository } from '../repositories/import-file.repository';
import { ImportSessionRepository } from '../repositories/import-session.repository';
import { ImportStagingEntryRepository } from '../repositories/import-staging-entry.repository';
import {
  DEFAULT_JOURNAL_OVERRIDE_KEY,
  DOCUMENT_TYPE_OVERRIDE_KEY,
  type DocumentType,
  type ImportSourceType,
  type ValidationError,
} from '../types/import-status';

export interface CommitResult {
  readonly sessionId: string;
  readonly committedRows: number;
  readonly entryIds: readonly string[];
  /**
   * Nombre de sous-comptes auto-créés dans `organization_chart_accounts`
   * juste avant le commit, à partir d'un parent SYSCOHADA détecté par
   * préfixe. Présent uniquement pour les sessions `trial_balance` —
   * les autres documentTypes laissent ce champ à `undefined` pour
   * rétrocompat (un consommateur qui ignore le champ continue de
   * fonctionner).
   *
   * Voir `ImportSessionService.autoProvisionMissingBalanceAccounts` —
   * débloque les imports balance Sage 8 chiffres sans paramétrage manuel.
   */
  readonly autoCreatedAccounts?: number;
}

/**
 * Garde-fou : au-delà de ce seuil, l'auto-provisioning émet un warning
 * (sans bloquer le commit). Un fichier qui réclame plus de comptes que
 * ça est plus probablement mal mappé qu'authentiquement énorme.
 */
const AUTO_PROVISION_WARN_THRESHOLD = 500;

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
  /** Axes analytiques (Option A — Migration 0092). */
  readonly analyticAxisType: string | null;
  readonly analyticAxisCode: string | null;
  /**
   * N° de pièce comptable. Obligatoire pour `entries` (décision produit
   * 2026-05-29) — clé de regroupement des lignes en une écriture. Vide
   * ('') pour les natures sans pièce (balance, relevé) où l'on retombe
   * sur un regroupement par date.
   */
  readonly pieceNumber: string;
  /** Métadonnées de pièce propagées à la ligne d'écriture (Migration 0110). */
  readonly invoiceNumber: string | null;
  readonly dueDate: string | null;
  readonly taxCode: string | null;
  readonly reference: string | null;
}
import type { MappedRow, TargetField } from '../types/mapping';
import { EntriesService, type CreateLineInput } from '../../journals/services/entries.service';
import { FileParserService } from './file-parser.service';
import { MappingService } from './mapping.service';
import { ValidationService, findParentAccountByPrefix, resolvePostingAccount } from './validation.service';

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
  readonly defaultJournalCode: string | null;
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
  /**
   * Suggestion non-bloquante : si l'utilisateur n'a PAS explicitement
   * choisi de `documentType` et que la structure du fichier ressemble
   * fortement à une balance (compte + débit + crédit présents, mais
   * date / journal / libellé absents), on propose un type au frontend
   * pour qu'il affiche un toast type "Ce fichier semble être une
   * balance — basculer sur 'trial_balance' ?". `null` si rien à suggérer
   * ou si le documentType est déjà fixé par l'utilisateur.
   */
  readonly suggestedDocumentType: DocumentType | null;
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
    private readonly referenceAccounts?: ReferenceAccountRepository,
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
      defaultJournalCode?: string | null;
    },
    actorUserId: string,
    ctx: AuditContext,
  ): Promise<SessionSummary> {
    // Le documentType et le journal par défaut sont stockés dans le JSONB
    // `mapping_override` sous des clés sentinelles (`__documentType`,
    // `__defaultJournalCode`) pour éviter une migration SQL. Le MappingService
    // extrait ces clés avant de traiter les overrides de header.
    const overrideSeed: Record<string, string> = {};
    if (input.documentType !== null && input.documentType !== undefined) {
      overrideSeed[DOCUMENT_TYPE_OVERRIDE_KEY] = input.documentType;
    }
    const seedJournal = input.defaultJournalCode?.trim();
    if (seedJournal !== undefined && seedJournal.length > 0) {
      overrideSeed[DEFAULT_JOURNAL_OVERRIDE_KEY] = seedJournal;
    }
    const initialOverride: Record<string, string> | null =
      Object.keys(overrideSeed).length > 0 ? overrideSeed : null;

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

  // ─── Update / Delete session (Module 3 wave 3) ──────────────────────

  /**
   * Update mutable session metadata. Two channels currently supported:
   *
   *   - `label` (string | null) — informational name shown in the list /
   *     detail. Allowed on every status (including `completed`) because
   *     it never propagates to committed journal entries.
   *   - `documentType` (DocumentType | null) — stored in `mapping_override`
   *     under the sentinel key. Allowed only BEFORE commit (`draft`,
   *     `parsing`, `parsed`, `validated`, `failed`). Forbidden on
   *     `completed` / `ready_for_import` because changing the document
   *     nature after commit would re-interpret already-written entries.
   *
   * Returns the refreshed `SessionSummary` so the caller can render the
   * post-update state without a second round-trip.
   */
  async updateSession(
    organizationId: TenantId,
    sessionId: string,
    patch: {
      label?: string | null;
      documentType?: DocumentType | null;
      defaultJournalCode?: string | null;
    },
    actorUserId: string,
    ctx: AuditContext,
  ): Promise<SessionSummary> {
    const session = await this.sessions.findById(sessionId, organizationId);
    if (session === null) {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_FOUND);
    }

    const labelTouched = Object.prototype.hasOwnProperty.call(patch, 'label');
    const docTypeTouched = Object.prototype.hasOwnProperty.call(patch, 'documentType');
    const defaultJournalTouched = Object.prototype.hasOwnProperty.call(
      patch,
      'defaultJournalCode',
    );

    if (!labelTouched && !docTypeTouched && !defaultJournalTouched) {
      // Nothing to do — surface a 422 rather than a silent no-op so the
      // caller knows their PATCH body was empty.
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_VALID, {
        message:
          'Nothing to update — provide at least `label`, `documentType` or `defaultJournalCode`.',
      });
    }

    if (docTypeTouched || defaultJournalTouched) {
      if (session.status === 'completed' || session.status === 'ready_for_import') {
        throw new AppException(ERROR_CODES.IMPORT_SESSION_CANNOT_DELETE, {
          message: `Le mapping ne peut pas être modifié sur une session "${session.status}".`,
        });
      }
      // Merge into the existing JSONB: keep header overrides, replace only
      // the sentinelles (`__documentType`, `__defaultJournalCode`).
      const existing = session.mappingOverride ?? {};
      const merged: Record<string, string> = { ...existing };
      if (docTypeTouched) {
        if (patch.documentType === null) {
          delete merged[DOCUMENT_TYPE_OVERRIDE_KEY];
        } else if (patch.documentType !== undefined) {
          merged[DOCUMENT_TYPE_OVERRIDE_KEY] = patch.documentType;
        }
      }
      if (defaultJournalTouched) {
        const trimmed = patch.defaultJournalCode?.trim();
        if (patch.defaultJournalCode === null || trimmed === undefined || trimmed === '') {
          delete merged[DEFAULT_JOURNAL_OVERRIDE_KEY];
        } else {
          merged[DEFAULT_JOURNAL_OVERRIDE_KEY] = trimmed;
        }
      }
      await this.sessions.updateMappingOverride(sessionId, organizationId, merged);

      // Same back-edit rule as `updateMappingOverride`: a `validated`
      // session repasses in `parsed` so the next preview re-validates.
      if (session.status === 'validated') {
        await this.sessions.updateStatus(sessionId, organizationId, 'parsed');
      }
    }

    if (labelTouched) {
      const trimmed = patch.label === null || patch.label === undefined ? null : patch.label.trim();
      const normalized = trimmed === '' ? null : trimmed;
      await this.sessions.updateLabel(sessionId, organizationId, normalized);
    }

    await this.audit.record({
      module: ImportSessionService.MODULE,
      action: 'session_updated',
      entityType: 'import_session',
      entityId: sessionId,
      before: {
        label: session.label,
        documentType: this.getDocumentType(session),
      },
      after: {
        ...(labelTouched ? { label: patch.label ?? null } : {}),
        ...(docTypeTouched ? { documentType: patch.documentType ?? null } : {}),
      },
      ctx: { ...ctx, userId: actorUserId, organizationId },
      legacyEventType: 'imports.session_updated',
    });

    const refreshed = await this.sessions.findById(sessionId, organizationId);
    return this.toSummary(refreshed ?? session);
  }

  /**
   * Hard delete a session and its on-disk file artifacts.
   *
   * Policy:
   *   - `completed` sessions are NEVER deletable — the journal entries
   *     they produced live on; deleting the source session would orphan
   *     the audit trail (`source_import_session_id` FK on
   *     `journal_entries`). To void a committed import, use the
   *     contre-passation flow from the Journals page.
   *   - Every other status (draft / parsing / parsed / validated /
   *     ready_for_import / failed) is deletable. We don't even
   *     special-case `parsing` — the parser holds the file open inside
   *     a single async call, not across requests, so by the time a
   *     DELETE lands the parser has either finished (status = parsed
   *     or parse_failed) or thrown.
   *
   * Sequence:
   *   1. Load every file row to capture `storagePath` BEFORE the DB
   *      cascade wipes them.
   *   2. DELETE the session row — Postgres cascades to `import_files`
   *      and `import_staging_entries` via the FK constraints declared
   *      in migrations 0016 / 0017.
   *   3. Remove the on-disk files (best-effort; a missing file is not
   *      an error because the row is already gone).
   *   4. Emit a single `session_deleted` audit event with enough metadata
   *      to reconstruct what was removed (status, totals, fileCount).
   */
  async deleteSession(
    organizationId: TenantId,
    sessionId: string,
    actorUserId: string,
    ctx: AuditContext,
  ): Promise<void> {
    const session = await this.sessions.findById(sessionId, organizationId);
    if (session === null) {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_FOUND);
    }
    if (session.status === 'completed') {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_CANNOT_DELETE, {
        message:
          'A completed import cannot be deleted because its journal entries are live. ' +
          'Use the contre-passation flow on the Journals page to void those entries.',
      });
    }

    // 1. Capture file paths BEFORE the DB cascade nukes them.
    const sessionFiles = await this.files.listBySession(sessionId, organizationId);
    const storagePaths = sessionFiles.map((f) => f.storagePath);

    // 2. DB delete (cascade handles staging_entries + files).
    const affected = await this.sessions.deleteById(sessionId, organizationId);
    if (affected === 0) {
      // Race: someone else deleted between findById and deleteById.
      // Treat as the same NOT_FOUND from the caller's point of view.
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_FOUND);
    }

    // 3. Disk cleanup — best-effort. A missing file is a no-op; a
    //    permission error or volume failure is logged but does not
    //    re-throw because the DB state is already consistent.
    for (const relativePath of storagePaths) {
      try {
        const absolute = this.resolveAbsolutePath(relativePath);
        await rm(absolute, { force: true });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[imports] Failed to remove on-disk file for deleted session ${sessionId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    await this.audit.record({
      module: ImportSessionService.MODULE,
      action: 'session_deleted',
      entityType: 'import_session',
      entityId: sessionId,
      before: {
        status: session.status,
        label: session.label,
        sourceType: session.sourceType,
        totalLines: session.totalLines,
        errorLines: session.errorLines,
        fileCount: storagePaths.length,
      },
      ctx: { ...ctx, userId: actorUserId, organizationId },
      legacyEventType: 'imports.session_deleted',
    });
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
    const documentType =
      (rawOverride[DOCUMENT_TYPE_OVERRIDE_KEY] as DocumentType | undefined) ?? null;
    const defaultJournalCode = (rawOverride[DEFAULT_JOURNAL_OVERRIDE_KEY] ?? '').trim() || null;
    const headerOverrides: Record<string, TargetField> = {};
    for (const [k, v] of Object.entries(rawOverride)) {
      if (k === DOCUMENT_TYPE_OVERRIDE_KEY || k === DEFAULT_JOURNAL_OVERRIDE_KEY) continue;
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
    const baseChart = this.validation.buildChartIndex(
      accounts.map((a) => ({
        code: a.code,
        accountType: a.accountType,
        isActive: a.isActive,
      })),
    );

    // Pour `trial_balance` ET `entries`, on enrichit le chart avec l'ensemble
    // des codes du référentiel SYSCOHADA, ce qui permet à `ValidationService`
    // de dégrader `unknown_account` en `unknown_account_with_parent_hint`
    // quand un préfixe parent existe (cas typique d'un Sage 8 chiffres
    // contre un plan org à 3-6 chiffres). Les sous-comptes manquants sont
    // ensuite auto-provisionnés au commit (cf. autoProvisionMissingBalanceAccounts).
    // `documentType` null = auto → la validation défaut à `entries`, donc on
    // résout aussi le défaut ici pour charger allReferenceCodes (sinon un
    // import journal sans documentType explicite resterait en unknown_account).
    const effectiveDocType: DocumentType = documentType ?? 'entries';
    const reconciliableDocType =
      effectiveDocType === 'trial_balance' || effectiveDocType === 'entries';
    const allReferenceCodes =
      reconciliableDocType && this.referenceAccounts !== undefined
        ? await this.loadAllReferenceCodes()
        : undefined;
    const chart = allReferenceCodes !== undefined ? { ...baseChart, allReferenceCodes } : baseChart;

    const stagingRows = await this.stagingEntries.listBySession(sessionId, organizationId, {
      limit: options.limit ?? 100,
      offset: options.offset ?? 0,
    });

    const entries: PreviewEntry[] = stagingRows.map((row) => {
      const rawMapped = this.mapping.applyMapping(row.rawValues, proposal.headerToTarget);
      // Canonicalisation du compte : réconcilie un code zéro-paddé Sage
      // (`40110000`) vers le compte imputable réel du plan (`4011`). On
      // persiste le code résolu dans `mappedValues`, donc la passation (qui
      // relit le persisté) écrit sur le bon compte sans étape supplémentaire.
      const rawAccount = rawMapped.account?.trim();
      const resolvedAccount =
        rawAccount !== undefined && rawAccount.length > 0
          ? resolvePostingAccount(rawAccount, chart.postingCodes)
          : null;
      const accountResolved =
        resolvedAccount !== null && resolvedAccount !== rawMapped.account
          ? { ...rawMapped, account: resolvedAccount }
          : rawMapped;
      // Injecte le journal par défaut quand le fichier ne porte pas de colonne
      // journal (export mono-journal). Persisté dans mappedValues → le commit
      // relit le persisté et groupe sur le bon journal.
      const mapped =
        defaultJournalCode !== null && (accountResolved.journal ?? '').trim() === ''
          ? { ...accountResolved, journal: defaultJournalCode }
          : accountResolved;
      const errors = this.validation.validateRow(mapped, {
        chart,
        documentType: documentType ?? undefined,
      });
      return {
        rowNumber: row.rowNumber,
        rawValues: row.rawValues,
        mappedValues: mapped,
        errors,
      };
    });

    // Auto-suggestion : si l'utilisateur n'a pas choisi de documentType
    // et que la structure du mapping ressemble fortement à une balance,
    // on propose `trial_balance` au frontend (toast non-bloquant).
    const suggestedDocumentType =
      documentType === null ? detectSuggestedDocumentType(proposal.headerToTarget) : null;

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
      suggestedDocumentType,
    };
  }

  /**
   * Load every code of the SYSCOHADA reference chart into a Set for
   * O(1) lookup during the parent-prefix hint resolution. Cached for
   * the duration of a single preview call (`undefined` between calls
   * so a future seed reload is picked up). Reference table is global
   * (no tenant scope) so this is safe across orgs.
   */
  private async loadAllReferenceCodes(): Promise<ReadonlySet<string> | undefined> {
    if (this.referenceAccounts === undefined) return undefined;
    // The SYSCOHADA AUDCIF system is the only one used by the MVP — if
    // an org runs on MINIMAL / ALLEGE the hint widens harmlessly to a
    // superset.
    const all = await this.referenceAccounts.listBySystem('NORMAL');
    return new Set(all.map((a) => a.code));
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private toSummary(s: ImportSessionEntity): SessionSummary {
    const docType = s.mappingOverride?.[DOCUMENT_TYPE_OVERRIDE_KEY] ?? null;
    const defaultJournal = (s.mappingOverride?.[DEFAULT_JOURNAL_OVERRIDE_KEY] ?? '').trim();
    return {
      id: s.id,
      status: s.status,
      sourceType: s.sourceType,
      label: s.label,
      totalLines: s.totalLines,
      errorLines: s.errorLines,
      createdAt: s.createdAt,
      documentType: (docType as DocumentType | null) ?? null,
      defaultJournalCode: defaultJournal.length > 0 ? defaultJournal : null,
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
   * Grouping note: rows are grouped by `(journalCode, pieceNumber)` when
   * a piece number is present (mandatory for `entries` — décision produit
   * 2026-05-29), so each accounting piece becomes one balanced entry.
   * Natures without a per-line piece (balance, bank statement) fall back
   * to `(journalCode, entryDate)`. The piece number is also written to
   * the entry `reference`. Closes `projet-ferme-l4g`.
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

    // Auto-provisioning balance — pour un trial_balance Sage 8 chiffres,
    // on crée automatiquement les sous-comptes manquants à partir des
    // parents SYSCOHADA détectés. S'exécute AVANT le compte d'erreurs
    // car la création supprime les `unknown_account_with_parent_hint`
    // qui sinon bloqueraient le commit.
    // `documentType` null = auto → défaut `entries` (cohérent avec la
    // validation), pour que l'auto-provisioning s'applique aux imports
    // journal sans documentType explicite.
    const documentType = this.getDocumentType(session) ?? 'entries';
    let autoCreatedAccounts: number | undefined;
    if (documentType === 'trial_balance' || documentType === 'entries') {
      autoCreatedAccounts = await this.autoProvisionMissingBalanceAccounts(
        organizationId,
        sessionId,
        actorUserId,
        ctx,
      );
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
    // Le journal par défaut (clé sentinelle) couvre les lignes dont le fichier
    // ne porte pas de colonne journal, y compris au-delà de la page de preview.
    const defaultJournalCode = this.getDefaultJournalCode(session);
    const drafts: StagingLineDraft[] = rows.map((r) =>
      this.projectStagingRow(r.rowNumber, r.mappedValues, defaultJournalCode),
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
          analyticAxisType: row.analyticAxisType,
          analyticAxisCode: row.analyticAxisCode,
          invoiceNumber: row.invoiceNumber,
          dueDate: row.dueDate,
          taxCode: row.taxCode,
          reference: row.reference,
        }));
        const pieceLabel =
          group.pieceNumber !== '' ? `pièce ${group.pieceNumber}` : group.entryDate;
        const draft = await this.entries.createDraft(
          organizationId,
          {
            journalCode: group.journalCode,
            entryDate: group.entryDate,
            description: `Import session ${sessionId} — ${group.journalCode} ${pieceLabel}`,
            reference: group.pieceNumber !== '' ? group.pieceNumber : null,
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
        autoCreatedAccounts: autoCreatedAccounts ?? 0,
      },
      ctx: { ...ctx, userId: actorUserId, organizationId },
      legacyEventType: 'imports.session_committed',
    });

    return {
      sessionId,
      committedRows: totals.total,
      entryIds: committedEntryIds,
      autoCreatedAccounts,
    };
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
  private projectStagingRow(
    rowNumber: number,
    mapped: MappedRow,
    defaultJournalCode: string | null = null,
  ): StagingLineDraft {
    const journalCode = (mapped.journal ?? '').trim() || (defaultJournalCode ?? '');
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
    const rawAxisType = (mapped.analyticAxisType ?? '').trim();
    const rawAxisCode = (mapped.analyticAxisCode ?? '').trim();
    // Invariant axe (Migration 0092) : (type IS NULL) = (code IS NULL).
    // Si une seule des 2 colonnes est mappée, on prend le code et
    // l'utilisateur DOIT avoir fixé un axisType au niveau de la
    // session (future feature — pour l'instant on accepte type seul).
    const analyticAxisType = rawAxisType === '' ? null : rawAxisType.toUpperCase();
    const analyticAxisCode = rawAxisCode === '' ? null : rawAxisCode;
    return {
      rowNumber,
      journalCode,
      entryDate,
      accountCode,
      label,
      debit,
      credit,
      partner: mapped.partner ?? null,
      analyticAxisType,
      analyticAxisCode,
      pieceNumber: (mapped.pieceNumber ?? '').trim(),
      invoiceNumber: emptyToNull(mapped.invoiceNumber),
      dueDate: emptyToNull(mapped.dueDate),
      taxCode: emptyToNull(mapped.taxCode),
      reference: emptyToNull(mapped.reference),
    };
  }

  /**
   * Regroupe les lignes projetées en écritures.
   *
   *   - Si la ligne porte un `pieceNumber` (cas `entries` — obligatoire),
   *     la clé est `(journalCode, pieceNumber)` : chaque pièce comptable
   *     forme UNE écriture, comme dans un journal réel.
   *   - Sinon (balance, relevé bancaire — pas de pièce par ligne), on
   *     retombe sur l'ancien regroupement `(journalCode, entryDate)` pour
   *     préserver le comportement de ces natures de documents.
   *
   * `entryDate` du groupe = date de la première ligne rencontrée (une
   * pièce porte une date unique en pratique ; un éventuel écart de date
   * intra-pièce sera capturé par la validation d'exercice en amont).
   */
  private groupByJournalAndDate(
    drafts: readonly StagingLineDraft[],
  ): Map<
    string,
    { journalCode: string; entryDate: string; pieceNumber: string; rows: StagingLineDraft[] }
  > {
    const groups = new Map<
      string,
      { journalCode: string; entryDate: string; pieceNumber: string; rows: StagingLineDraft[] }
    >();
    for (const d of drafts) {
      const key =
        d.pieceNumber !== ''
          ? `${d.journalCode}|P|${d.pieceNumber}`
          : `${d.journalCode}|D|${d.entryDate}`;
      const bucket = groups.get(key);
      if (bucket === undefined) {
        groups.set(key, {
          journalCode: d.journalCode,
          entryDate: d.entryDate,
          pieceNumber: d.pieceNumber,
          rows: [d],
        });
      } else {
        bucket.rows.push(d);
      }
    }
    return groups;
  }

  private collectUnbalancedGroups(
    groups: ReadonlyMap<
      string,
      { journalCode: string; entryDate: string; pieceNumber: string; rows: StagingLineDraft[] }
    >,
  ): Array<{
    journalCode: string;
    entryDate: string;
    pieceNumber: string | null;
    totalDebit: number;
    totalCredit: number;
    rowCount: number;
  }> {
    const out: Array<{
      journalCode: string;
      entryDate: string;
      pieceNumber: string | null;
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
          pieceNumber: group.pieceNumber !== '' ? group.pieceNumber : null,
          totalDebit: Math.round(totalDebit * 100) / 100,
          totalCredit: Math.round(totalCredit * 100) / 100,
          rowCount: group.rows.length,
        });
      }
    }
    return out;
  }

  // ─── Auto-provisioning balance ────────────────────────────────────

  /**
   * Pour une session `trial_balance` : examine les staging rows, repère
   * les comptes inconnus de l'organisation qui matchent un parent
   * SYSCOHADA par préfixe (cas typique d'un fichier Sage à 8 chiffres
   * contre un plan org à 3-6 chiffres), et CRÉE les sous-comptes
   * manquants en les rattachant au parent référentiel détecté.
   *
   * Tolérances :
   *   - idempotent : un check `findByCode` préalable évite la
   *     duplication, et la contrainte unique `(organization_id, code)`
   *     en DB est la deuxième barrière. Un 2e commit consécutif est un
   *     no-op (0 comptes créés).
   *   - sans parent : un compte qui ne match aucun préfixe est ignoré
   *     (warning), il restera flaggé `unknown_account` après commit et
   *     fera échouer la phase suivante — comportement attendu.
   *   - > 500 comptes : warning loggé via audit metadata, mais le commit
   *     continue. Au-delà, l'utilisateur a probablement mal mappé son
   *     fichier (entête mal détectée → toutes les lignes inconnues).
   *
   * Transactionnel : chaque création est un `INSERT` indépendant via le
   * repository org-account (pas de tx Postgres explicite ici, le
   * `EntriesService.createDraft` en aval ouvre la sienne par groupe).
   * Si un INSERT échoue, l'exception remonte et `commitSession` repasse
   * la session en `failed` via le path d'erreur classique — les comptes
   * déjà créés AVANT l'échec restent en DB (idempotent au prochain run).
   *
   * Renvoie le nombre de comptes effectivement créés (peut être 0).
   */
  private async autoProvisionMissingBalanceAccounts(
    organizationId: TenantId,
    sessionId: string,
    actorUserId: string,
    ctx: AuditContext,
  ): Promise<number> {
    if (this.referenceAccounts === undefined) {
      // Sans accès au référentiel, on ne peut pas déterminer les
      // parents — silent skip (le commit échouera proprement plus loin
      // si des comptes sont inconnus).
      return 0;
    }

    // 1. Charger tous les staging rows + extraire les comptes inconnus
    //    qui ont une erreur `unknown_account_with_parent_hint`.
    const rows = await this.loadAllStagingRows(sessionId, organizationId);
    const candidateCodes = new Set<string>();
    for (const row of rows) {
      const account = (row.mappedValues.account ?? '').trim();
      if (account.length === 0) continue;
      candidateCodes.add(account);
    }
    if (candidateCodes.size === 0) {
      return 0;
    }

    // 2. Préparer les index : chart org + référentiel global, pour
    //    réutiliser `findParentAccountByPrefix` à l'identique de la
    //    phase validation.
    const orgAccounts = await this.chartAccounts.listByOrganization(organizationId, {
      activeOnly: true,
    });
    const orgCodeSet = new Set(orgAccounts.map((a) => a.code));
    const allReferenceCodes = await this.loadAllReferenceCodes();
    if (allReferenceCodes === undefined) {
      return 0;
    }

    // 3. Pour chaque compte candidat absent du plan org : trouver son
    //    parent référentiel et créer l'org-account dérivé.
    let created = 0;
    const missingWithParents: Array<{ account: string; parentCode: string }> = [];
    for (const account of candidateCodes) {
      if (orgCodeSet.has(account)) continue;
      const parentCode = findParentAccountByPrefix(account, orgCodeSet, allReferenceCodes);
      if (parentCode === null) {
        // Pas de parent — on log et on continue, le compte restera
        // flaggé après la re-validation.
        // eslint-disable-next-line no-console
        console.warn(
          `[imports] No SYSCOHADA parent prefix found for account "${account}" — skipping auto-provision`,
        );
        continue;
      }
      missingWithParents.push({ account, parentCode });
    }

    if (missingWithParents.length === 0) {
      return 0;
    }

    if (missingWithParents.length > AUTO_PROVISION_WARN_THRESHOLD) {
      // eslint-disable-next-line no-console
      console.warn(
        `[imports] Auto-provisioning ${missingWithParents.length} accounts for session ${sessionId} ` +
          `— this exceeds the soft threshold (${AUTO_PROVISION_WARN_THRESHOLD}). The file may be mis-mapped.`,
      );
    }

    // Cache des parents référentiels chargés (un même parent peut
    // servir 50+ enfants — évite 50 round-trips).
    const parentCache = new Map<string, Awaited<ReturnType<typeof this.fetchReferenceParent>>>();

    for (const { account, parentCode } of missingWithParents) {
      let parent = parentCache.get(parentCode);
      if (parent === undefined) {
        parent = await this.fetchReferenceParent(parentCode);
        parentCache.set(parentCode, parent);
      }
      if (parent === null) {
        // eslint-disable-next-line no-console
        console.warn(
          `[imports] Reference parent "${parentCode}" not found in reference_chart_accounts for account "${account}"`,
        );
        continue;
      }

      // Idempotence : si une exécution antérieure (ou un autre worker) a
      // déjà créé ce compte, ne pas re-créer.
      const existing = await this.chartAccounts.findByCode(account, organizationId);
      if (existing !== null) {
        // Ajouter au set pour la re-validation ci-dessous.
        orgCodeSet.add(account);
        continue;
      }

      // Le parent référentiel peut être lui-même un TITLE (cas général
      // dans SYSCOHADA), mais le nouveau compte feuille est POSTING.
      // Si une org-account dérivée du parent existe déjà, on récupère
      // son `id` comme parentId pour la cohérence arborescente. Sinon,
      // parentId reste null (le compte vivra à la racine côté org).
      const parentOrgAccount = await this.chartAccounts.findByCode(parentCode, organizationId);
      await this.chartAccounts.create({
        organizationId,
        code: account,
        // Label dérivé du parent — préfixe le code source pour
        // distinguer visuellement les sous-comptes auto-créés des
        // comptes natifs.
        label: `${parent.label} — ${account}`,
        class: parent.class,
        accountType: 'POSTING',
        normalBalance: parent.normalBalance,
        parentId: parentOrgAccount?.id ?? null,
        referenceAccountId: null,
        isActive: true,
      });
      orgCodeSet.add(account);
      created += 1;

      await this.audit.record({
        module: ImportSessionService.MODULE,
        action: 'organization_account.auto_created_from_balance',
        entityType: 'organization_account',
        entityId: account,
        after: {
          code: account,
          parentCode,
          class: parent.class,
          normalBalance: parent.normalBalance,
          sessionId,
        },
        ctx: { ...ctx, userId: actorUserId, organizationId },
        legacyEventType: 'imports.account_auto_created',
      });
    }

    if (created === 0) {
      return 0;
    }

    // 4. Re-valider les staging rows pour vider les
    //    `unknown_account_with_parent_hint` désormais obsolètes —
    //    indispensable, sinon le compte d'erreurs en aval bloquerait
    //    le commit malgré la création.
    await this.revalidateStagingRows(sessionId, organizationId, orgAccounts, orgCodeSet);
    return created;
  }

  private async fetchReferenceParent(parentCode: string): Promise<{
    code: string;
    label: string;
    class: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    normalBalance: 'D' | 'C';
  } | null> {
    if (this.referenceAccounts === undefined) return null;
    const ref = await this.referenceAccounts.findByCode(parentCode);
    if (ref === null) return null;
    return {
      code: ref.code,
      label: ref.label,
      class: ref.class,
      normalBalance: ref.normalBalance,
    };
  }

  /**
   * Re-passe la validation sur toutes les staging rows de la session
   * avec le chart MIS À JOUR (nouveaux org-accounts inclus), et
   * persiste les erreurs recalculées. Indispensable après une vague
   * d'auto-provisioning pour que `countBySession.withErrors` reflète
   * la réalité avant le check de commit.
   */
  private async revalidateStagingRows(
    sessionId: string,
    organizationId: TenantId,
    initialOrgAccounts: ReadonlyArray<{
      code: string;
      accountType: 'POSTING' | 'TITLE';
      isActive: boolean;
    }>,
    augmentedOrgCodes: ReadonlySet<string>,
  ): Promise<void> {
    // Construire le set des codes POSTING actifs en intégrant les codes
    // augmentés (les nouveaux auto-créés sont par construction POSTING
    // + actifs, donc on peut les fusionner sans recharger).
    const postingCodes = new Set<string>(
      initialOrgAccounts
        .filter((a) => a.accountType === 'POSTING' && a.isActive)
        .map((a) => a.code),
    );
    for (const code of augmentedOrgCodes) {
      postingCodes.add(code);
    }
    const allReferenceCodes = (await this.loadAllReferenceCodes()) ?? new Set<string>();
    const chart = { postingCodes, allReferenceCodes };

    const pageSize = 500;
    let offset = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await this.stagingEntries.listBySession(sessionId, organizationId, {
        limit: pageSize,
        offset,
      });
      if (page.length === 0) break;
      const patch = page.map((row) => ({
        id: row.id,
        mappedValues: row.mappedValues,
        errors: this.validation.validateRow(row.mappedValues, {
          chart,
          documentType: 'trial_balance' as const,
        }),
      }));
      await this.stagingEntries.updateMappedValuesAndErrors(patch);
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    // Re-synchroniser le compteur `errorLines` de la session pour que
    // le check `withErrors > 0` ci-après reflète l'état post-provision.
    const totals = await this.stagingEntries.countBySession(sessionId, organizationId);
    await this.sessions.updateCounters(sessionId, organizationId, {
      totalLines: totals.total,
      errorLines: totals.withErrors,
    });
  }

  private getDocumentType(session: ImportSessionEntity): DocumentType | null {
    const raw = session.mappingOverride?.[DOCUMENT_TYPE_OVERRIDE_KEY] ?? null;
    return (raw as DocumentType | null) ?? null;
  }

  /** Journal par défaut (clé sentinelle) appliqué aux lignes sans colonne journal. */
  private getDefaultJournalCode(session: ImportSessionEntity): string | null {
    const raw = (session.mappingOverride?.[DEFAULT_JOURNAL_OVERRIDE_KEY] ?? '').trim();
    return raw.length > 0 ? raw : null;
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
    const existingDocType = session.mappingOverride?.[DOCUMENT_TYPE_OVERRIDE_KEY] ?? null;
    const existingDefaultJournal = session.mappingOverride?.[DEFAULT_JOURNAL_OVERRIDE_KEY] ?? null;
    const merged: Record<string, string> = { ...mappingOverride };
    if (existingDocType !== null && merged[DOCUMENT_TYPE_OVERRIDE_KEY] === undefined) {
      merged[DOCUMENT_TYPE_OVERRIDE_KEY] = existingDocType;
    }
    if (existingDefaultJournal !== null && merged[DEFAULT_JOURNAL_OVERRIDE_KEY] === undefined) {
      merged[DEFAULT_JOURNAL_OVERRIDE_KEY] = existingDefaultJournal;
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
  /**
   * Exposed for tests (pure function, no I/O).
   */
  /**
   * Délègue à la fonction `detectSuggestedDocumentType` exportée plus bas
   * dans le fichier (fonction pure exposée pour les tests).
   */
  static detectSuggestedDocumentType(
    mapping: Readonly<Record<string, TargetField>>,
  ): DocumentType | null {
    return detectSuggestedDocumentType(mapping);
  }

  static sanitizeErrorMessage(raw: string): string {
    // POSIX absolute paths: /foo/bar, /var/uploads/orgid/...
    // Windows absolute paths: C:\foo\bar or \\share\path
    const sanitized = raw
      .replace(/(?:[A-Za-z]:[/\\]|\/)[^\s"'<>{}|\\^[\]`]*[^\s"'<>{}|\\^[\]`.,;:]/g, '<path>')
      .slice(0, 500);
    return sanitized || 'Parsing error';
  }
}

/**
 * Heuristique pure : décide si le mapping détecté à l'auto-mapping
 * suggère un `DocumentType` plus pertinent que `entries` (le défaut
 * historique).
 *
 * Règle actuelle (MVP) :
 *   - `trial_balance` proposé si on a un compte ET au moins un
 *     montant (débit OU crédit), MAIS pas de date NI de journal.
 *     Critère structurel : > 60 % des "champs typiques d'écriture"
 *     manquants alors que les "champs typiques de balance" sont là.
 *
 * Le frontend reçoit la suggestion via `PreviewResult.suggestedDocumentType`.
 * Elle est purement informative — aucune action serveur n'est
 * déclenchée par sa présence.
 */
function detectSuggestedDocumentType(
  mapping: Readonly<Record<string, TargetField>>,
): DocumentType | null {
  const targets = new Set(Object.values(mapping));
  const hasAccount = targets.has('account');
  const hasAmount = targets.has('debit') || targets.has('credit');
  const hasDate = targets.has('date');
  const hasJournal = targets.has('journal');
  const hasLabel = targets.has('label');

  // Balance pattern: compte + montant(s), pas de date NI de journal.
  // Le libellé peut être absent (Sage exporte parfois juste compte +
  // intitulé court qui se mappe ailleurs) — on ne s'en sert pas dans
  // le critère.
  if (hasAccount && hasAmount && !hasDate && !hasJournal) {
    // Confirmation par ratio des "champs écriture" manquants
    // (date + journal + label = 3 attendus pour entries).
    const entriesFields = [hasDate, hasJournal, hasLabel];
    const missing = entriesFields.filter((p) => !p).length;
    if (missing / entriesFields.length > 0.6) {
      return 'trial_balance';
    }
  }

  return null;
}

/**
 * Normalise une valeur mappée optionnelle : trim puis `null` si vide.
 * Garde les métadonnées de pièce (facture, échéance, taxe, référence)
 * propres avant de les écrire sur la ligne d'écriture.
 */
function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
