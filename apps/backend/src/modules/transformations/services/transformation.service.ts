import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { ImportStagingEntryEntity } from '../../imports/entities/import-staging-entry.entity';
import { ImportSessionEntity } from '../../imports/entities/import-session.entity';
import type { AdjustEntryDto } from '../dto/adjust-entry.dto';
import type { ReclassifyEntryDto } from '../dto/reclassify-entry.dto';
import { EntryTransformationEntity } from '../entities/entry-transformation.entity';
import { EntryTransformationRepository } from '../repositories/entry-transformation.repository';
import type { TransformationDiff } from '../types/transformation.types';

export interface TransformationSummary {
  readonly id: string;
  readonly type: EntryTransformationEntity['type'];
  readonly status: EntryTransformationEntity['status'];
  readonly sourceEntryId: string;
  readonly beforeValues: TransformationDiff;
  readonly afterValues: TransformationDiff;
  readonly notes: string | null;
  readonly createdById: string;
  readonly createdAt: Date;
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
}

/**
 * `TransformationService` — Module 4 Transformation Engine (wave 1).
 *
 * Invariant fondamental : les écritures sources (`import_staging_entries`)
 * ne sont JAMAIS modifiées. Chaque transformation est un artefact
 * supplémentaire (`entry_transformations`) qui capture le diff before/after
 * et conserve l'historique complet pour undo/redo (vague 2).
 *
 * Toutes les mutations sont auditées via `AuditTrailService` (module
 * 'transformations'). Les appels audit sont swallow-and-warn — une
 * panne du service d'audit ne bloque jamais la transformation elle-même.
 */
@Injectable()
export class TransformationService {
  private static readonly MODULE = 'transformations' as const;

  constructor(
    private readonly transformationRepo: EntryTransformationRepository,
    @InjectRepository(ImportStagingEntryEntity)
    private readonly stagingRepo: Repository<ImportStagingEntryEntity>,
    private readonly audit: AuditTrailService,
  ) {}

  /**
   * Reclassify a source entry by changing its account, journal, partner,
   * or label WITHOUT touching the source entry itself. Creates an
   * `entry_transformations` row with type 'reclassification'.
   *
   * At least one reclassifiable field must be provided — if none is
   * given, the call is a no-op and should be rejected client-side before
   * reaching here, but the service guards it as well.
   */
  async reclassifyEntry(
    organizationId: TenantId,
    actorId: string,
    dto: ReclassifyEntryDto,
    ctx: AuditContext,
  ): Promise<TransformationSummary> {
    const entry = await this.resolveSourceEntry(organizationId, dto.sourceEntryId);

    const before: TransformationDiff = {};
    const after: TransformationDiff = {};

    if (dto.account !== undefined) {
      before.account = entry.mappedValues.account ?? null;
      after.account = dto.account;
    }
    if (dto.journal !== undefined) {
      before.journal = entry.mappedValues.journal ?? null;
      after.journal = dto.journal;
    }
    if (dto.partner !== undefined) {
      before.partner = entry.mappedValues.partner ?? null;
      after.partner = dto.partner;
    }
    if (dto.label !== undefined) {
      before.label = entry.mappedValues.label ?? null;
      after.label = dto.label;
    }

    const hasChanges = Object.keys(after).length > 0;
    if (!hasChanges) {
      throw new AppException(ERROR_CODES.TRANSFORMATION_NO_FIELD_CHANGED, {
        message:
          'At least one field (account, journal, partner, label) must be provided for reclassification.',
      });
    }

    const transformation = await this.transformationRepo.create({
      organizationId,
      sourceEntryId: dto.sourceEntryId,
      type: 'reclassification',
      beforeValues: before,
      afterValues: after,
      notes: dto.notes ?? null,
      createdById: actorId,
    });

    await this.audit.record({
      module: TransformationService.MODULE,
      action: 'entry_reclassified',
      entityType: 'entry_transformation',
      entityId: transformation.id,
      before,
      after,
      metadata: { sourceEntryId: dto.sourceEntryId },
      ctx,
    });

    return this.toSummary(transformation);
  }

  /**
   * Create an adjustment entry linked to a source entry.
   * The adjustment captures an additional debit or credit amount
   * (e.g. an end-of-period regularisation entry) without touching the source.
   *
   * Exactly one of `adjustmentDebit` or `adjustmentCredit` must be set.
   */
  async adjustEntry(
    organizationId: TenantId,
    actorId: string,
    dto: AdjustEntryDto,
    ctx: AuditContext,
  ): Promise<TransformationSummary> {
    const hasBoth = dto.adjustmentDebit !== undefined && dto.adjustmentCredit !== undefined;
    const hasNeither = dto.adjustmentDebit === undefined && dto.adjustmentCredit === undefined;

    if (hasBoth || hasNeither) {
      throw new AppException(ERROR_CODES.TRANSFORMATION_ADJUSTMENT_INVALID, {
        message: 'Exactly one of adjustmentDebit or adjustmentCredit must be provided.',
      });
    }

    await this.resolveSourceEntry(organizationId, dto.sourceEntryId);

    const after: TransformationDiff = {
      adjustmentDebit: dto.adjustmentDebit ?? null,
      adjustmentCredit: dto.adjustmentCredit ?? null,
      adjustmentLabel: dto.adjustmentLabel,
    };

    const transformation = await this.transformationRepo.create({
      organizationId,
      sourceEntryId: dto.sourceEntryId,
      type: 'adjustment',
      beforeValues: {},
      afterValues: after,
      notes: dto.notes ?? null,
      createdById: actorId,
    });

    await this.audit.record({
      module: TransformationService.MODULE,
      action: 'entry_adjusted',
      entityType: 'entry_transformation',
      entityId: transformation.id,
      after,
      metadata: { sourceEntryId: dto.sourceEntryId },
      ctx,
    });

    return this.toSummary(transformation);
  }

  /**
   * Return the full transformation history for a source entry, ordered
   * chronologically (oldest first). Includes cancelled transformations so
   * the caller can render the complete undo/redo trail.
   */
  async getEntryHistory(
    organizationId: TenantId,
    sourceEntryId: string,
  ): Promise<TransformationSummary[]> {
    // Verify the entry belongs to this tenant before returning its history.
    await this.resolveSourceEntry(organizationId, sourceEntryId);

    const transformations = await this.transformationRepo.findBySourceEntry(
      organizationId,
      sourceEntryId,
    );

    return transformations.map((t) => this.toSummary(t));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve a staging entry by ID, verifying it belongs to this org.
   * Cross-tenant access raises a 404 (fail-closed — avoids disclosing
   * whether an entry exists in another tenant's data).
   */
  private async resolveSourceEntry(
    organizationId: TenantId,
    sourceEntryId: string,
  ): Promise<ImportStagingEntryEntity> {
    // JOIN on import_sessions to verify the tenant scope without
    // adding organization_id to staging entries itself.
    const entry = await this.stagingRepo
      .createQueryBuilder('e')
      .innerJoin(ImportSessionEntity, 's', 's.id = e.session_id')
      .where('e.id = :sourceEntryId', { sourceEntryId })
      .andWhere('s.organization_id = :organizationId', { organizationId })
      .getOne();

    if (!entry) {
      throw new AppException(ERROR_CODES.TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND, {
        message: `Source entry '${sourceEntryId}' not found or does not belong to this organization.`,
      });
    }

    return entry;
  }

  private toSummary(t: EntryTransformationEntity): TransformationSummary {
    return {
      id: t.id,
      type: t.type,
      status: t.status,
      sourceEntryId: t.sourceEntryId,
      beforeValues: t.beforeValues,
      afterValues: t.afterValues,
      notes: t.notes,
      createdById: t.createdById,
      createdAt: t.createdAt,
      cancelledAt: t.cancelledAt,
      cancelReason: t.cancelReason,
    };
  }
}
