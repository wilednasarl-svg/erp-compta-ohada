import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { RegularizationEntryEntity } from '../entities/regularization-entry.entity';
import type { RegularizationType } from '../types/regularization.types';

export interface CreateRegularizationEntryInput {
  readonly batchId: string;
  readonly organizationId: TenantId | string;
  readonly type: RegularizationType;
  readonly expenseRevenueAccount: string;
  readonly regularizationAccount: string;
  readonly amount: string;
  readonly tvaAmount?: string;
  readonly label?: string;
}

/**
 * W3.5 — Repository tenant-scope pour `regularization_entries`.
 */
@Injectable()
export class RegularizationEntriesRepository {
  constructor(
    @InjectRepository(RegularizationEntryEntity)
    private readonly repo: Repository<RegularizationEntryEntity>,
  ) {}

  async create(
    input: CreateRegularizationEntryInput,
    manager?: EntityManager,
  ): Promise<RegularizationEntryEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(RegularizationEntryEntity) : this.repo;
    const entity = repo.create({
      batchId: input.batchId,
      organizationId: input.organizationId,
      type: input.type,
      expenseRevenueAccount: input.expenseRevenueAccount,
      regularizationAccount: input.regularizationAccount,
      amount: input.amount,
      tvaAmount: input.tvaAmount ?? '0',
      label: input.label ?? '',
    });
    return repo.save(entity);
  }

  async save(
    entity: RegularizationEntryEntity,
    manager?: EntityManager,
  ): Promise<RegularizationEntryEntity> {
    assertTenantId(entity.organizationId);
    const repo = manager ? manager.getRepository(RegularizationEntryEntity) : this.repo;
    return repo.save(entity);
  }

  async listByBatch(
    batchId: string,
    organizationId: TenantId | string,
  ): Promise<RegularizationEntryEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { batchId, organizationId },
      order: { createdAt: 'ASC' },
    });
  }

  async delete(
    id: string,
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(RegularizationEntryEntity) : this.repo;
    await repo.delete({ id, organizationId });
  }
}
