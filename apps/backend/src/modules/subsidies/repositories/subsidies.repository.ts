import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { SubsidyEntity } from '../entities/subsidy.entity';
import type { SubsidyReleaseMethod, SubsidyStatus } from '../types/subsidy.types';

export interface CreateSubsidyInput {
  readonly organizationId: TenantId | string;
  readonly assetId?: string | null;
  readonly grantorName: string;
  readonly grantDate: string;
  readonly totalAmount: string;
  readonly releaseMethod: SubsidyReleaseMethod;
  readonly journalEntryIdGrant?: string | null;
  readonly note?: string | null;
  readonly createdById?: string | null;
}

export interface UpdateSubsidyInput {
  readonly releasedAmount?: string;
  readonly status?: SubsidyStatus;
  readonly closedAt?: Date | null;
  readonly journalEntryIdGrant?: string | null;
}

export interface ListSubsidiesFilters {
  readonly status?: SubsidyStatus;
  readonly assetId?: string;
}

@Injectable()
export class SubsidiesRepository {
  constructor(
    @InjectRepository(SubsidyEntity)
    private readonly repo: Repository<SubsidyEntity>,
  ) {}

  async create(input: CreateSubsidyInput, manager?: EntityManager): Promise<SubsidyEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(SubsidyEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      assetId: input.assetId ?? null,
      grantorName: input.grantorName,
      grantDate: input.grantDate,
      totalAmount: input.totalAmount,
      releasedAmount: '0.00',
      releaseMethod: input.releaseMethod,
      status: 'active',
      journalEntryIdGrant: input.journalEntryIdGrant ?? null,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
      closedAt: null,
    });
    return repo.save(entity);
  }

  async findById(id: string, organizationId: TenantId | string): Promise<SubsidyEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async listByOrganization(
    organizationId: TenantId | string,
    filters: ListSubsidiesFilters = {},
  ): Promise<SubsidyEntity[]> {
    assertTenantId(organizationId);
    const where: Record<string, unknown> = { organizationId };
    if (filters.status) where.status = filters.status;
    if (filters.assetId) where.assetId = filters.assetId;
    return this.repo.find({
      where,
      order: { grantDate: 'DESC', createdAt: 'DESC' },
    });
  }

  async update(
    id: string,
    organizationId: TenantId | string,
    patch: UpdateSubsidyInput,
    manager?: EntityManager,
  ): Promise<SubsidyEntity> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(SubsidyEntity) : this.repo;
    await repo.update({ id, organizationId }, patch);
    const updated = await repo.findOne({ where: { id, organizationId } });
    if (!updated) {
      throw new Error(`Subsidy ${id} disappeared after UPDATE in org ${organizationId}`);
    }
    return updated;
  }
}
