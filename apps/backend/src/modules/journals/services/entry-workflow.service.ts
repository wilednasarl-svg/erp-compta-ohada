import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { WorkflowService } from '../../workflows/services/workflow.service';
import type {
  WorkflowEventView,
  WorkflowInstanceView,
} from '../../workflows/services/workflow.service';
import { EntrySignatureEntity, type EntrySignerRole } from '../entities/entry-signature.entity';
import type { JournalEntryEntity } from '../entities/journal-entry.entity';
import { EntrySignatureRepository } from '../repositories/entry-signature.repository';
import { JournalEntryLineRepository } from '../repositories/journal-entry-line.repository';
import { JournalEntryRepository } from '../repositories/journal-entry.repository';
import { EntriesService } from './entries.service';

export interface SubmitForReviewOptions {
  readonly organizationId: TenantId;
  readonly entryId: string;
  readonly actorId: string;
  readonly comment?: string | null;
  readonly ctx: AuditContext;
}

export interface ApproveOptions extends SubmitForReviewOptions {}

export interface RejectOptions {
  readonly organizationId: TenantId;
  readonly entryId: string;
  readonly actorId: string;
  readonly reason: string;
  readonly ctx: AuditContext;
}

export interface SignOptions extends SubmitForReviewOptions {}

export interface SignatureView {
  readonly id: string;
  readonly signerId: string;
  readonly signerRole: EntrySignerRole;
  readonly signatureHash: string;
  readonly comment: string | null;
  readonly signedAt: Date;
}

export interface EntryWorkflowView {
  readonly entryId: string;
  readonly entryStatus: string;
  readonly workflow: WorkflowInstanceView;
  readonly signatures: SignatureView[];
}

export interface EntryWorkflowHistoryView {
  readonly entryId: string;
  readonly entryStatus: string;
  readonly workflow: WorkflowInstanceView | null;
  readonly events: WorkflowEventView[];
  readonly signatures: SignatureView[];
}

/**
 * `EntryWorkflowService` — Module 14 wave 1.
 *
 * Orchestre le workflow Module 6 sur la cible `journal_entry` et appose
 * les signatures électroniques (`entry_signatures`) à chaque palier :
 *
 *   submit-for-review : draft     → in_review   (auteur)
 *   approve           : in_review → approved    (chef_mission, signe)
 *   reject            : in_review → draft       (chef_mission)
 *                     | approved  → in_review   (expert_comptable)
 *   sign              : approved  → locked      (expert_comptable, signe
 *                                                + entry.validated)
 *
 * Invariant fort : la transition `sign` rend l'entry `validated` via
 * `EntriesService.validate`. Tout est exécuté dans une transaction
 * commune (signature + transition workflow + validate). Si une étape
 * échoue (période fermée, déjà signée), rien n'est persisté.
 */
@Injectable()
export class EntryWorkflowService {
  private static readonly MODULE = 'journals' as const;
  private readonly logger = new Logger(EntryWorkflowService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly entries: EntriesService,
    private readonly entryRepo: JournalEntryRepository,
    private readonly lineRepo: JournalEntryLineRepository,
    private readonly signatures: EntrySignatureRepository,
    private readonly workflow: WorkflowService,
    private readonly audit: AuditTrailService,
  ) {}

  async submitForReview(options: SubmitForReviewOptions): Promise<EntryWorkflowView> {
    const { organizationId, entryId, comment, ctx } = options;
    assertTenantId(organizationId);

    const entry = await this.getOrThrow(organizationId, entryId);
    if (entry.status !== 'draft') {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS, {
        message: `Entry must be in 'draft' to be submitted for review (got '${entry.status}').`,
      });
    }

    const instance = await this.workflow.startWorkflow({
      organizationId,
      targetType: 'journal_entry',
      targetId: entryId,
      ctx,
    });

    let current = instance;
    if (current.currentStatus === 'draft') {
      current = await this.workflow.transition({
        instanceId: current.id,
        organizationId,
        toStatus: 'in_review',
        comment: comment ?? null,
        ctx,
      });
    } else if (current.currentStatus !== 'in_review') {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS, {
        message: `Workflow already at '${current.currentStatus}' — cannot resubmit.`,
      });
    }

    await this.emitAudit('entry_submitted_for_review', entryId, { comment: comment ?? null }, ctx);

    return this.buildView(entry, current, organizationId);
  }

  async approve(options: ApproveOptions): Promise<EntryWorkflowView> {
    const { organizationId, entryId, actorId, comment, ctx } = options;
    assertTenantId(organizationId);

    const entry = await this.getOrThrow(organizationId, entryId);
    const instance = await this.requireInstance(organizationId, entryId);

    if (instance.currentStatus !== 'in_review') {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS, {
        message: `Cannot approve from workflow status '${instance.currentStatus}' (expected 'in_review').`,
      });
    }

    const existing = await this.signatures.findByEntryAndRole(
      organizationId,
      entryId,
      'chef_mission',
    );
    if (existing) {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_ALREADY_SIGNED, {
        message: 'Entry already signed by a chef de mission.',
      });
    }

    const signatureHash = await this.computeSignatureHash(entry);

    const next = await this.dataSource.transaction(async () => {
      await this.signatures.create({
        organizationId,
        journalEntryId: entryId,
        signerId: actorId,
        signerRole: 'chef_mission',
        signatureHash,
        comment: comment ?? null,
      });

      return this.workflow.transition({
        instanceId: instance.id,
        organizationId,
        toStatus: 'approved',
        comment: comment ?? null,
        ctx,
      });
    });

    await this.emitAudit(
      'entry_approved',
      entryId,
      { signerRole: 'chef_mission', signatureHash },
      ctx,
    );

    return this.buildView(entry, next, organizationId);
  }

  async reject(options: RejectOptions): Promise<EntryWorkflowView> {
    const { organizationId, entryId, reason, ctx } = options;
    assertTenantId(organizationId);

    if (!reason || reason.trim().length < 3) {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_REJECT_REASON_REQUIRED, {
        message: 'A non-empty rejection reason (>=3 chars) is mandatory.',
      });
    }

    const entry = await this.getOrThrow(organizationId, entryId);
    const instance = await this.requireInstance(organizationId, entryId);

    let toStatus: 'draft' | 'in_review';
    if (instance.currentStatus === 'in_review') {
      toStatus = 'draft';
    } else if (instance.currentStatus === 'approved') {
      toStatus = 'in_review';
    } else {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS, {
        message: `Cannot reject from workflow status '${instance.currentStatus}'.`,
      });
    }

    const next = await this.workflow.transition({
      instanceId: instance.id,
      organizationId,
      toStatus,
      comment: reason,
      ctx,
    });

    await this.emitAudit(
      'entry_rejected',
      entryId,
      { reason, fromStatus: instance.currentStatus, toStatus },
      ctx,
    );

    return this.buildView(entry, next, organizationId);
  }

  async sign(options: SignOptions): Promise<EntryWorkflowView> {
    const { organizationId, entryId, actorId, comment, ctx } = options;
    assertTenantId(organizationId);

    const entry = await this.getOrThrow(organizationId, entryId);
    const instance = await this.requireInstance(organizationId, entryId);

    if (instance.currentStatus !== 'approved') {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS, {
        message: `Cannot sign from workflow status '${instance.currentStatus}' (expected 'approved').`,
      });
    }

    if (entry.status !== 'draft') {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS, {
        message: `Underlying entry must be 'draft' before final signature (got '${entry.status}').`,
      });
    }

    const existing = await this.signatures.findByEntryAndRole(
      organizationId,
      entryId,
      'expert_comptable',
    );
    if (existing) {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_ALREADY_SIGNED, {
        message: 'Entry already signed by an expert-comptable.',
      });
    }

    const signatureHash = await this.computeSignatureHash(entry);

    const next = await this.dataSource.transaction(async () => {
      // 1) Validate l'entry comptable (status: draft → validated). Échoue
      //    si la période a été fermée entre l'approbation et la signature
      //    finale — la transaction rollback alors signature + workflow.
      await this.entries.validate(organizationId, entryId, actorId, ctx);

      // 2) Apposer la signature finale.
      await this.signatures.create({
        organizationId,
        journalEntryId: entryId,
        signerId: actorId,
        signerRole: 'expert_comptable',
        signatureHash,
        comment: comment ?? null,
      });

      // 3) Lock le workflow (terminal state).
      return this.workflow.transition({
        instanceId: instance.id,
        organizationId,
        toStatus: 'locked',
        comment: comment ?? null,
        ctx,
      });
    });

    await this.emitAudit(
      'entry_signed',
      entryId,
      { signerRole: 'expert_comptable', signatureHash },
      ctx,
    );

    const refreshed = await this.getOrThrow(organizationId, entryId);
    return this.buildView(refreshed, next, organizationId);
  }

  async getHistory(organizationId: TenantId, entryId: string): Promise<EntryWorkflowHistoryView> {
    assertTenantId(organizationId);
    const entry = await this.getOrThrow(organizationId, entryId);

    const instance = await this.workflow.findInstanceByTarget(
      organizationId,
      'journal_entry',
      entryId,
    );

    const events = instance ? await this.workflow.getHistory(instance.id, organizationId) : [];
    const sigs = await this.signatures.listByEntry(organizationId, entryId);

    return {
      entryId,
      entryStatus: entry.status,
      workflow: instance,
      events,
      signatures: sigs.map((s) => this.toSignatureView(s)),
    };
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private async getOrThrow(organizationId: TenantId, entryId: string): Promise<JournalEntryEntity> {
    const entry = await this.entryRepo.findById(entryId, organizationId);
    if (!entry) {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_NOT_FOUND, {
        message: `Journal entry not found: ${entryId}`,
      });
    }
    return entry;
  }

  private async requireInstance(
    organizationId: TenantId,
    entryId: string,
  ): Promise<WorkflowInstanceView> {
    const instance = await this.workflow.findInstanceByTarget(
      organizationId,
      'journal_entry',
      entryId,
    );
    if (!instance) {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS, {
        message: 'Entry has not been submitted for review yet.',
      });
    }
    return instance;
  }

  /**
   * Sérialisation canonique (clés ordonnées, lignes triées par position)
   * → SHA-256 hex (64 chars) pour matcher le CHECK SQL de la migration 0055.
   */
  private async computeSignatureHash(entry: JournalEntryEntity): Promise<string> {
    const lines = await this.lineRepo.listByEntry(entry.id);
    const canonical = {
      entryId: entry.id,
      organizationId: entry.organizationId,
      journalId: entry.journalId,
      periodId: entry.periodId,
      entryNumber: entry.entryNumber,
      entryDate: entry.entryDate,
      description: entry.description,
      reference: entry.reference,
      lines: lines
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((l) => ({
          position: l.position,
          accountId: l.accountId,
          debit: String(l.debit),
          credit: String(l.credit),
          description: l.description ?? null,
        })),
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  private async buildView(
    entry: JournalEntryEntity,
    workflow: WorkflowInstanceView,
    organizationId: TenantId,
  ): Promise<EntryWorkflowView> {
    const sigs = await this.signatures.listByEntry(organizationId, entry.id);
    return {
      entryId: entry.id,
      entryStatus: entry.status,
      workflow,
      signatures: sigs.map((s) => this.toSignatureView(s)),
    };
  }

  private toSignatureView(s: EntrySignatureEntity): SignatureView {
    return {
      id: s.id,
      signerId: s.signerId,
      signerRole: s.signerRole,
      signatureHash: s.signatureHash,
      comment: s.comment,
      signedAt: s.signedAt,
    };
  }

  private async emitAudit(
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
    ctx: AuditContext,
  ): Promise<void> {
    try {
      await this.audit.record({
        module: EntryWorkflowService.MODULE,
        action: `journals.${action}`,
        entityType: 'journal_entry',
        entityId,
        metadata,
        ctx,
      });
    } catch (e: unknown) {
      this.logger.warn(`Audit failed for ${action}: ${String(e)}`);
    }
  }
}
