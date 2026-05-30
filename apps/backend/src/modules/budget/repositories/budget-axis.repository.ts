import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { BudgetAxisEntity } from '../entities/budget-axis.entity';
import type { BudgetAxisType } from '../types/budget.types';

export interface CreateBudgetAxisInput {
  readonly organizationId: TenantId | string;
  readonly axisType: BudgetAxisType;
  readonly code: string;
  readonly label: string;
  readonly parentId?: string | null;
  readonly isActive?: boolean;
}

export interface UpdateBudgetAxisInput {
  readonly label?: string;
  readonly parentId?: string | null;
  readonly isActive?: boolean;
}

export interface ListBudgetAxesFilter {
  readonly axisType?: BudgetAxisType;
  readonly activeOnly?: boolean;
}

@Injectable()
export class BudgetAxisRepository {
  constructor(
    @InjectRepository(BudgetAxisEntity)
    private readonly repo: Repository<BudgetAxisEntity>,
  ) {}

  async create(input: CreateBudgetAxisInput, manager?: EntityManager): Promise<BudgetAxisEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(BudgetAxisEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      axisType: input.axisType,
      code: input.code,
      label: input.label,
      parentId: input.parentId ?? null,
      isActive: input.isActive ?? true,
    });
    return repo.save(entity);
  }

  async findById(id: string, organizationId: TenantId | string): Promise<BudgetAxisEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findByCode(
    organizationId: TenantId | string,
    axisType: BudgetAxisType,
    code: string,
  ): Promise<BudgetAxisEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { organizationId, axisType, code } });
  }

  async list(
    organizationId: TenantId | string,
    filter: ListBudgetAxesFilter = {},
  ): Promise<BudgetAxisEntity[]> {
    assertTenantId(organizationId);
    const qb = this.repo
      .createQueryBuilder('axis')
      .where('axis.organization_id = :organizationId', { organizationId });

    if (filter.axisType) {
      qb.andWhere('axis.axis_type = :axisType', { axisType: filter.axisType });
    }
    if (filter.activeOnly) {
      qb.andWhere('axis.is_active = TRUE');
    }

    return qb.orderBy('axis.axis_type', 'ASC').addOrderBy('axis.code', 'ASC').getMany();
  }

  async update(
    entity: BudgetAxisEntity,
    input: UpdateBudgetAxisInput,
    manager?: EntityManager,
  ): Promise<BudgetAxisEntity> {
    const repo = manager ? manager.getRepository(BudgetAxisEntity) : this.repo;
    const next = repo.create({
      ...entity,
      label: input.label ?? entity.label,
      parentId: input.parentId === undefined ? entity.parentId : input.parentId,
      isActive: input.isActive ?? entity.isActive,
    });
    return repo.save(next);
  }
}
