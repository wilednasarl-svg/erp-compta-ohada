import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { EntryTransformationEntity } from '../entities/entry-transformation.entity';
import type {
  TransformationDiff,
  TransformationStatus,
  TransformationType,
} from '../types/transformation.types';

export interface CreateTransformationInput {
  readonly organizationId: TenantId;
  readonly sourceEntryId: string;
  readonly type: TransformationType;
  readonly beforeValues: TransformationDiff;
  readonly afterValues: TransformationDiff;
  readonly notes?: string | null;
  readonly createdById: string;
}

/**
 * Tenant-scoped repository for `entry_transformations`.
 *
 * Every public method requires `organizationId` (TenantId) and filters
 * on it. This makes cross-tenant access a compile-time error, not a
 * runtime chance.
 */
@Injectable()
export class EntryTransformationRepository {
  constructor(
    @InjectRepository(EntryTransformationEntity)
    private readonly repo: Repository<EntryTransformationEntity>,
  ) {}

  async create(input: CreateTransformationInput): Promise<EntryTransformationEntity> {
    assertTenantId(input.organizationId);
    const entity = this.repo.create({
      organizationId: input.organizationId,
      sourceEntryId: input.sourceEntryId,
      type: input.type,
      status: 'active' as TransformationStatus,
      beforeValues: input.beforeValues,
      afterValues: input.afterValues,
      notes: input.notes ?? null,
      createdById: input.createdById,
      cancelledAt: null,
      cancelledById: null,
      cancelReason: null,
    });
    return this.repo.save(entity);
  }

  async findBySourceEntry(
    organizationId: TenantId,
    sourceEntryId: string,
  ): Promise<EntryTransformationEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, sourceEntryId },
      order: { createdAt: 'ASC' },
    });
  }

  async findById(organizationId: TenantId, id: string): Promise<EntryTransformationEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { organizationId, id } });
  }
}
