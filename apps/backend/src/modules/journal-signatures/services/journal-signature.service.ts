import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { JournalEntryLineRepository } from '../../journals/repositories/journal-entry-line.repository';
import { JournalEntryRepository } from '../../journals/repositories/journal-entry.repository';
import { EntriesService } from '../../journals/services/entries.service';
import { WorkflowService } from '../../workflows/services/workflow.service';
import type {
  WorkflowEventView,
  WorkflowInstanceView,
} from '../../workflows/services/workflow.service';
import { EntrySignatureEntity } from '../entities/entry-signature.entity';
import { EntrySignatureRepository } from '../repositories/entry-signature.repository';
import type { SignerRole } from '../types/journal-signature.types';

export interface SignatureView {
  readonly id: string;
  readonly journalEntryId: string;
  readonly signerId: string;
  readonly signerRole: SignerRole;
  readonly signatureHash: string;
  readonly comment: string | null;
  readonly signedAt: Date;
}

export interface JournalEntryWorkflowView {
  readonly workflow: WorkflowInstanceView;
  readonly signatures: SignatureView[];
  readonly history: WorkflowEventView[];
}

/**
 * `JournalSignatureService` (Module 14 wave 1).
 *
 * Orchestre le cycle d'approbation et de signature d'une écriture journal
 * en réutilisant le moteur Module 6 (`WorkflowService`).
 *
 * Cycle métier :
 *
 *   draft  ─submitForReview→  in_review
 *   in_review ─approve (chef_mission signe)→ approved
 *   in_review ─reject→ draft (avec reason obligatoire)
 *   approved  ─sign (expert_comptable signe)→ locked
 *                       + EntriesService.validate (status → 'validated')
 *
 * Invariants :
 *   - 1 signature par rôle par entry (contrainte UNIQUE en base).
 *   - Le hash de signature est calculé sur une projection canonique de
 *     l'entry au moment de la signature — résistant aux modifications
 *     ultérieures puisque, dès `validated`, l'entry est immutable.
 *   - L'audit trail journalise chaque transition (action: `signature_*`).
 */
@Injectable()
export class JournalSignatureService {
  private readonly logger = new Logger(JournalSignatureService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly entries: EntriesService,
    private readonly workflow: WorkflowService,
    private readonly signatures: EntrySignatureRepository,
    private readonly entryRepo: JournalEntryRepository,
    private readonly lineRepo: JournalEntryLineRepository,
    private readonly audit: AuditTrailService,
  ) {}

  async submitForReview(
    organizationId: TenantId,
    entryId: string,
    comment: string | null,
    actorId: string,
    ctx: AuditContext,
  ): Promise<JournalEntryWorkflowView> {
    assertTenantId(organizationId);
    await this.assertEntryIsDraft(organizationId, entryId);

    const instance = await this.workflow.startWorkflow({
      organizationId,
      targetType: 'journal_entry',
      targetId: entryId,
      ctx,
    });

    if (instance.currentStatus !== 'draft') {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS, {
        message: `Workflow is in '${instance.currentStatus}', cannot submit for review.`,
      });
    }

    const transitioned = await this.workflow.transition({
      instanceId: instance.id,
      organizationId,
      toStatus: 'in_review',
      comment,
      ctx,
    });

    await this.emitAudit('entry_submitted_for_review', entryId, { actorId, comment }, ctx);
    return this.buildView(organizationId, entryId, transitioned);
  }

  async approve(
    organizationId: TenantId,
    entryId: string,
    comment: string | null,
    actorId: string,
    ctx: AuditContext,
  ): Promise<JournalEntryWorkflowView> {
    assertTenantId(organizationId);

    const instance = await this.requireInstance(organizationId, entryId);
    if (instance.currentStatus !== 'in_review') {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS, {
        message: `Cannot approve from status '${instance.currentStatus}'.`,
      });
    }

    const existing = await this.signatures.findByEntryAndRole(
      organizationId,
      entryId,
      'chef_mission',
    );
    if (existing) {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_ALREADY_SIGNED, {
        message: 'Entry has already been signed by a chef de mission.',
      });
    }

    const signatureHash = await this.computeSignatureHash(organizationId, entryId);

    return this.dataSource.transaction(async () => {
      await this.signatures.create({
        organizationId,
        journalEntryId: entryId,
        signerId: actorId,
        signerRole: 'chef_mission',
        signatureHash,
        comment,
      });

      const transitioned = await this.workflow.transition({
        instanceId: instance.id,
        organizationId,
        toStatus: 'approved',
        comment,
        ctx,
      });

      await this.emitAudit(
        'entry_approved',
        entryId,
        { actorId, signerRole: 'chef_mission' as const, signatureHash },
        ctx,
      );

      return this.buildView(organizationId, entryId, transitioned);
    });
  }

  async reject(
    organizationId: TenantId,
    entryId: string,
    reason: string,
    actorId: string,
    ctx: AuditContext,
  ): Promise<JournalEntryWorkflowView> {
    assertTenantId(organizationId);

    if (!reason || reason.trim().length < 3) {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_REJECT_REASON_REQUIRED, {
        message: 'A non-empty reason (>=3 chars) is required to reject an entry.',
      });
    }

    const instance = await this.requireInstance(organizationId, entryId);
    if (instance.currentStatus !== 'in_review') {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS, {
        message: `Cannot reject from status '${instance.currentStatus}'.`,
      });
    }

    const transitioned = await this.workflow.transition({
      instanceId: instance.id,
      organizationId,
      toStatus: 'draft',
      comment: reason,
      ctx,
    });

    await this.emitAudit('entry_rejected', entryId, { actorId, reason }, ctx);
    return this.buildView(organizationId, entryId, transitioned);
  }

  async sign(
    organizationId: TenantId,
    entryId: string,
    comment: string | null,
    actorId: string,
    ctx: AuditContext,
  ): Promise<JournalEntryWorkflowView> {
    assertTenantId(organizationId);

    const instance = await this.requireInstance(organizationId, entryId);
    if (instance.currentStatus !== 'approved') {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS, {
        message: `Cannot sign from status '${instance.currentStatus}'. Approval by chef de mission required first.`,
      });
    }

    const existing = await this.signatures.findByEntryAndRole(
      organizationId,
      entryId,
      'expert_comptable',
    );
    if (existing) {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_ALREADY_SIGNED, {
        message: 'Entry has already been signed by an expert-comptable.',
      });
    }

    const signatureHash = await this.computeSignatureHash(organizationId, entryId);

    return this.dataSource.transaction(async () => {
      await this.signatures.create({
        organizationId,
        journalEntryId: entryId,
        signerId: actorId,
        signerRole: 'expert_comptable',
        signatureHash,
        comment,
      });

      await this.entries.validate(organizationId, entryId, actorId, ctx);

      const transitioned = await this.workflow.transition({
        instanceId: instance.id,
        organizationId,
        toStatus: 'locked',
        comment,
        ctx,
      });

      await this.emitAudit(
        'entry_signed',
        entryId,
        { actorId, signerRole: 'expert_comptable' as const, signatureHash },
        ctx,
      );

      return this.buildView(organizationId, entryId, transitioned);
    });
  }

  async getStatus(
    organizationId: TenantId,
    entryId: string,
  ): Promise<JournalEntryWorkflowView | null> {
    assertTenantId(organizationId);

    const entry = await this.entryRepo.findById(entryId, organizationId);
    if (!entry) {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_NOT_FOUND, {
        message: `Entry ${entryId} not found.`,
      });
    }

    const instance = await this.workflow.findInstanceByTarget(
      organizationId,
      'journal_entry',
      entryId,
    );
    if (!instance) {
      return null;
    }
    return this.buildView(organizationId, entryId, instance);
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private async assertEntryIsDraft(organizationId: string, entryId: string): Promise<void> {
    const entry = await this.entryRepo.findById(entryId, organizationId);
    if (!entry) {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_NOT_FOUND, {
        message: `Entry ${entryId} not found.`,
      });
    }
    if (entry.status !== 'draft') {
      throw new AppException(ERROR_CODES.ENTRY_SIGNATURE_INVALID_STATUS, {
        message: `Entry status is '${entry.status}'; only draft entries can enter the approval workflow.`,
      });
    }
  }

  private async requireInstance(
    organizationId: string,
    entryId: string,
  ): Promise<WorkflowInstanceView> {
    const entry = await this.entryRepo.findById(entryId, organizationId);
    if (!entry) {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_NOT_FOUND, {
        message: `Entry ${entryId} not found.`,
      });
    }

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

  private async computeSignatureHash(organizationId: string, entryId: string): Promise<string> {
    const entry = await this.entryRepo.findById(entryId, organizationId);
    if (!entry) {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_NOT_FOUND);
    }
    const lines = await this.lineRepo.listByEntry(entryId);

    const canonical = {
      organizationId: entry.organizationId,
      journalId: entry.journalId,
      periodId: entry.periodId,
      entryNumber: entry.entryNumber,
      entryDate: entry.entryDate,
      description: entry.description,
      reference: entry.reference,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        position: l.position,
        debit: String(l.debit),
        credit: String(l.credit),
        description: l.description ?? null,
      })),
    };

    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  private async buildView(
    organizationId: string,
    entryId: string,
    instance: WorkflowInstanceView,
  ): Promise<JournalEntryWorkflowView> {
    const [signatures, history] = await Promise.all([
      this.signatures.listByEntry(organizationId, entryId),
      this.workflow.getHistory(instance.id, organizationId),
    ]);

    return {
      workflow: instance,
      signatures: signatures.map((s) => this.toSignatureView(s)),
      history,
    };
  }

  private toSignatureView(s: EntrySignatureEntity): SignatureView {
    return {
      id: s.id,
      journalEntryId: s.journalEntryId,
      signerId: s.signerId,
      signerRole: s.signerRole,
      signatureHash: s.signatureHash,
      comment: s.comment,
      signedAt: s.signedAt,
    };
  }

  private async emitAudit(
    action: string,
    entryId: string,
    metadata: Record<string, unknown>,
    ctx: AuditContext,
  ): Promise<void> {
    try {
      await this.audit.record({
        module: 'journals',
        action,
        entityType: 'journal_entry',
        entityId: entryId,
        metadata,
        ctx,
      });
    } catch (e: unknown) {
      this.logger.warn(`Audit emit failed: ${String(e)}`);
    }
  }
}
