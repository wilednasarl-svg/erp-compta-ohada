import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { RegularizationBatchEntity } from '../entities/regularization-batch.entity';
import type { RegularizationBatchStatus } from '../types/regularization.types';

export interface CreateRegularizationBatchInput {
  readonly organizationId: TenantId | string;
  readonly exerciseEndDate: string;
  readonly reversalDate: string;
  readonly label?: string;
  readonly createdById?: string | null;
  readonly status?: RegularizationBatchStatus;
}

export interface UpdateRegularizationBatchInput {
  readonly status?: RegularizationBatchStatus;
  readonly label?: string;
  readonly journalEntryId?: string | null;
  readonly reversalJournalEntryId?: string | null;
  readonly executedAt?: Date | null;
  readonly executedById?: string | null;
  readonly reversedAt?: Date | null;
  readonly reversedById?: string | null;
  readonly cancelledAt?: Date | null;
}

export interface ListRegularizationBatchesFilters {
  readonly status?: RegularizationBatchStatus;
  readonly exerciseEndDate?: string;
}

/**
 * W3.5 — Repository tenant-scope pour `regularization_batches`.
 *
 * Aucun accès cross-organisation possible : toutes les méthodes
 * exigent un `organizationId` validé via `assertTenantId`.
 */
@Injectable()
export class RegularizationBatchesRepository {
  constructor(
    @InjectRepository(RegularizationBatchEntity)
    private readonly repo: Repository<RegularizationBatchEntity>,
  ) {}

  async create(
    input: CreateRegularizationBatchInput,
    manager?: EntityManager,
  ): Promise<RegularizationBatchEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(RegularizationBatchEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      exerciseEndDate: input.exerciseEndDate,
      reversalDate: input.reversalDate,
      label: input.label ?? '',
      status: input.status ?? 'draft',
      createdById: input.createdById ?? null,
      journalEntryId: null,
      reversalJournalEntryId: null,
      executedAt: null,
      executedById: null,
      reversedAt: null,
      reversedById: null,
      cancelledAt: null,
    });
    return repo.save(entity);
  }

  async findById(
    organizationId: TenantId | string,
    id: string,
  ): Promise<RegularizationBatchEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async listByOrg(
    organizationId: TenantId | string,
    filters: ListRegularizationBatchesFilters = {},
  ): Promise<RegularizationBatchEntity[]> {
    assertTenantId(organizationId);
    const where: Record<string, unknown> = { organizationId };
    if (filters.status) where.status = filters.status;
    if (filters.exerciseEndDate) where.exerciseEndDate = filters.exerciseEndDate;
    return this.repo.find({
      where,
      order: { exerciseEndDate: 'DESC', createdAt: 'DESC' },
    });
  }

  async update(
    organizationId: TenantId | string,
    id: string,
    patch: UpdateRegularizationBatchInput,
    manager?: EntityManager,
  ): Promise<RegularizationBatchEntity> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(RegularizationBatchEntity) : this.repo;
    await repo.update({ id, organizationId }, patch);
    const updated = await repo.findOne({ where: { id, organizationId } });
    if (!updated) {
      throw new Error(
        `RegularizationBatch ${id} disappeared after UPDATE in org ${organizationId}`,
      );
    }
    return updated;
  }

  /**
   * Alias `save` exposé pour cohérence avec la convention TypeORM. Le
   * service consomme `create`/`update`, mais certains tests peuvent
   * vouloir persister une entité directement.
   */
  async save(
    entity: RegularizationBatchEntity,
    manager?: EntityManager,
  ): Promise<RegularizationBatchEntity> {
    assertTenantId(entity.organizationId);
    const repo = manager ? manager.getRepository(RegularizationBatchEntity) : this.repo;
    return repo.save(entity);
  }
}
