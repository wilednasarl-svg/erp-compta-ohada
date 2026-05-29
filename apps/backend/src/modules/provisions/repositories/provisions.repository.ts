import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { ProvisionEntity } from '../entities/provision.entity';
import type { ProvisionStatus, ProvisionType } from '../types/provision.types';

export interface CreateProvisionInput {
  readonly organizationId: TenantId | string;
  readonly type: ProvisionType;
  readonly accountCode: string;
  readonly label: string;
  readonly initialAmount: string;
  readonly currentAmount: string;
  readonly status?: ProvisionStatus;
  readonly createdById?: string | null;
}

export interface UpdateProvisionInput {
  readonly label?: string;
  readonly currentAmount?: string;
  readonly status?: ProvisionStatus;
  readonly closedAt?: Date | null;
  readonly closedById?: string | null;
}

export interface ListProvisionsFilters {
  readonly status?: ProvisionStatus;
  readonly type?: ProvisionType;
}

@Injectable()
export class ProvisionsRepository {
  constructor(
    @InjectRepository(ProvisionEntity)
    private readonly repo: Repository<ProvisionEntity>,
  ) {}

  async create(input: CreateProvisionInput, manager?: EntityManager): Promise<ProvisionEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(ProvisionEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      type: input.type,
      accountCode: input.accountCode,
      label: input.label,
      initialAmount: input.initialAmount,
      currentAmount: input.currentAmount,
      status: input.status ?? 'active',
      createdById: input.createdById ?? null,
      closedById: null,
      closedAt: null,
    });
    return repo.save(entity);
  }

  async findById(id: string, organizationId: TenantId | string): Promise<ProvisionEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async listByOrganization(
    organizationId: TenantId | string,
    filters: ListProvisionsFilters = {},
  ): Promise<ProvisionEntity[]> {
    assertTenantId(organizationId);
    const where: Record<string, unknown> = { organizationId };
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    return this.repo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async update(
    id: string,
    organizationId: TenantId | string,
    patch: UpdateProvisionInput,
    manager?: EntityManager,
  ): Promise<ProvisionEntity> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(ProvisionEntity) : this.repo;
    await repo.update({ id, organizationId }, patch);
    const updated = await repo.findOne({ where: { id, organizationId } });
    if (!updated) {
      throw new Error(`Provision ${id} disappeared after UPDATE in org ${organizationId}`);
    }
    return updated;
  }
}
