import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { LeaseEntity } from '../entities/lease.entity';
import type { LeaseFrequency, LeaseStatus } from '../types/lease.types';

export interface CreateLeaseInput {
  readonly organizationId: TenantId | string;
  readonly assetId?: string | null;
  readonly contractRef: string;
  readonly lessorName: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly fairValue: string;
  readonly nominalTotalAmount: string;
  readonly implicitRate: string;
  readonly purchaseOptionAmount: string;
  readonly frequency: LeaseFrequency;
  readonly numberOfInstallments: number;
  readonly status?: LeaseStatus;
  readonly note?: string | null;
  readonly createdById?: string | null;
}

export interface UpdateLeaseInput {
  readonly status?: LeaseStatus;
  readonly journalEntryIdInitial?: string | null;
  readonly assetId?: string | null;
  readonly note?: string | null;
}

export interface ListLeasesFilters {
  readonly status?: LeaseStatus;
  readonly assetId?: string;
}

@Injectable()
export class LeasesRepository {
  constructor(
    @InjectRepository(LeaseEntity)
    private readonly repo: Repository<LeaseEntity>,
  ) {}

  async create(input: CreateLeaseInput, manager?: EntityManager): Promise<LeaseEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(LeaseEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      assetId: input.assetId ?? null,
      contractRef: input.contractRef,
      lessorName: input.lessorName,
      startDate: input.startDate,
      endDate: input.endDate,
      fairValue: input.fairValue,
      nominalTotalAmount: input.nominalTotalAmount,
      implicitRate: input.implicitRate,
      purchaseOptionAmount: input.purchaseOptionAmount,
      frequency: input.frequency,
      numberOfInstallments: input.numberOfInstallments,
      status: input.status ?? 'active',
      journalEntryIdInitial: null,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    });
    return repo.save(entity);
  }

  async findById(id: string, organizationId: TenantId | string): Promise<LeaseEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async listByOrganization(
    organizationId: TenantId | string,
    filters: ListLeasesFilters = {},
  ): Promise<LeaseEntity[]> {
    assertTenantId(organizationId);
    const where: Record<string, unknown> = { organizationId };
    if (filters.status) where.status = filters.status;
    if (filters.assetId) where.assetId = filters.assetId;
    return this.repo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async update(
    id: string,
    organizationId: TenantId | string,
    patch: UpdateLeaseInput,
    manager?: EntityManager,
  ): Promise<LeaseEntity> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(LeaseEntity) : this.repo;
    await repo.update({ id, organizationId }, patch);
    const updated = await repo.findOne({ where: { id, organizationId } });
    if (!updated) {
      throw new Error(`Lease ${id} disappeared after UPDATE in org ${organizationId}`);
    }
    return updated;
  }
}
