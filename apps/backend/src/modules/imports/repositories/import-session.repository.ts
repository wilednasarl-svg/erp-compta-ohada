import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { ImportSessionEntity } from '../entities/import-session.entity';
import type { ImportSessionStatus, ImportSourceType } from '../types/import-status';

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

  async updateStatus(
    id: string,
    organizationId: TenantId | string,
    status: ImportSessionStatus,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    await this.scoped(manager).update({ id, organizationId }, { status });
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
}
