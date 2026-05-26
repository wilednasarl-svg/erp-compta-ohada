import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { ImportSessionEntity } from '../entities/import-session.entity';
import {
  canTransitionTo,
  type ImportSessionStatus,
  type ImportSourceType,
} from '../types/import-status';

/**
 * Tenant-scoped repository for `import_sessions`.
 *
 * Every public method requires an `organizationId` and runs
 * `assertTenantId` first — the `TenantId` brand makes the scope a
 * compile-time obligation, and the runtime guard rejects empty values.
 * Cross-tenant exposure here would break the multi-tenant contract
 * enforced upstream by `TenantGuard`.
 *
 * Methods accept an optional `EntityManager` so the service layer can
 * compose them into a transaction (e.g. create session + initial audit
 * row in a single commit).
 */
@Injectable()
export class ImportSessionRepository {
  constructor(
    @InjectRepository(ImportSessionEntity)
    private readonly repo: Repository<ImportSessionEntity>,
  ) {}

  private scoped(manager?: EntityManager): Repository<ImportSessionEntity> {
    return manager ? manager.getRepository(ImportSessionEntity) : this.repo;
  }

  async create(
    input: {
      organizationId: TenantId | string;
      sourceType: ImportSourceType;
      createdById: string;
      label?: string | null;
      companyId?: string | null;
      fiscalYear?: string | null;
      mappingOverride?: Record<string, string> | null;
    },
    manager?: EntityManager,
  ): Promise<ImportSessionEntity> {
    assertTenantId(input.organizationId);
    const repo = this.scoped(manager);
    const entity = repo.create({
      organizationId: input.organizationId,
      sourceType: input.sourceType,
      createdById: input.createdById,
      label: input.label ?? null,
      companyId: input.companyId ?? null,
      fiscalYear: input.fiscalYear ?? null,
      mappingOverride: input.mappingOverride ?? null,
      status: 'draft',
      totalLines: 0,
      errorLines: 0,
    });
    return repo.save(entity);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<ImportSessionEntity | null> {
    assertTenantId(organizationId);
    return this.scoped(manager).findOne({ where: { id, organizationId } });
  }

  async listByOrganization(
    organizationId: TenantId | string,
    options: { status?: ImportSessionStatus; limit?: number } = {},
  ): Promise<ImportSessionEntity[]> {
    assertTenantId(organizationId);
    const where: Record<string, unknown> = { organizationId };
    if (options.status !== undefined) {
      where['status'] = options.status;
    }
    return this.repo.find({
      where,
      order: { createdAt: 'DESC' },
      take: options.limit ?? 50,
    });
  }

  /**
   * Transition the session to `status` ONLY if the move is allowed by
   * `VALID_STATUS_TRANSITIONS`. The update is conditional on the
   * current status (`UPDATE … WHERE status IN (allowed_from_states)`)
   * so the check is atomic at the SQL level — a concurrent transition
   * race can't bypass the machine.
   *
   * Returns silently when 0 rows were affected (row not found OR
   * disallowed transition) — the service layer is expected to read
   * the current status first if it needs to discriminate.
   */
  async updateStatus(
    id: string,
    organizationId: TenantId | string,
    status: ImportSessionStatus,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    const allowedFromStates: ImportSessionStatus[] = (
      ['draft', 'parsing', 'parsed', 'validated', 'ready_for_import', 'failed'] as const
    ).filter((s) => canTransitionTo(s, status));
    if (allowedFromStates.length === 0) {
      // No state in the machine can legally reach `status` — caller bug.
      return;
    }
    await this.scoped(manager)
      .createQueryBuilder()
      .update(ImportSessionEntity)
      .set({ status })
      .where('id = :id', { id })
      .andWhere('organization_id = :organizationId', { organizationId })
      .andWhere('status IN (:...allowedFromStates)', { allowedFromStates })
      .execute();
  }

  async markFailed(
    id: string,
    organizationId: TenantId | string,
    failureReason: string,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    await this.scoped(manager).update({ id, organizationId }, { status: 'failed', failureReason });
  }

  async updateCounters(
    id: string,
    organizationId: TenantId | string,
    counters: { totalLines: number; errorLines: number },
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    await this.scoped(manager).update(
      { id, organizationId },
      {
        totalLines: counters.totalLines,
        errorLines: counters.errorLines,
      },
    );
  }

  async updateMappingOverride(
    id: string,
    organizationId: TenantId | string,
    mappingOverride: Record<string, string>,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    await this.scoped(manager).update({ id, organizationId }, { mappingOverride });
  }

  /**
   * Update the human-friendly `label`. Allowed on every status because
   * the label is informational only (it never appears on committed
   * journal entries — those carry their own `description`). Passing
   * `null` clears the label.
   */
  async updateLabel(
    id: string,
    organizationId: TenantId | string,
    label: string | null,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    await this.scoped(manager).update({ id, organizationId }, { label });
  }

  /**
   * Hard delete a session. The database FKs cascade to `import_files`
   * and `import_staging_entries` (see migrations 0016 / 0017). Physical
   * files on disk must be removed by the caller BEFORE invoking this
   * method — once the row is gone, the `storage_path` references vanish
   * with it and any leftover bytes become orphans on the volume.
   *
   * Returns the number of rows actually deleted (`0` if the session no
   * longer exists or belongs to another tenant) — callers can use this
   * to short-circuit follow-up audit writes on a stale ID.
   */
  async deleteById(
    id: string,
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<number> {
    assertTenantId(organizationId);
    const result = await this.scoped(manager)
      .createQueryBuilder()
      .delete()
      .from(ImportSessionEntity)
      .where('id = :id', { id })
      .andWhere('organization_id = :organizationId', { organizationId })
      .execute();
    return result.affected ?? 0;
  }
}
