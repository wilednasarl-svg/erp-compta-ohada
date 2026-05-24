import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { RuleEntity } from '../entities/rule.entity';
import type { RuleAction, RuleCondition } from '../types/rule.types';

export interface CreateRuleInput {
  readonly organizationId: TenantId;
  readonly name: string;
  readonly description?: string | null;
  readonly isActive?: boolean;
  readonly priority?: number;
  readonly conditions: RuleCondition[];
  readonly actions: RuleAction[];
  readonly createdById: string;
}

export interface UpdateRuleInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly isActive?: boolean;
  readonly priority?: number;
  readonly conditions?: RuleCondition[];
  readonly actions?: RuleAction[];
  readonly updatedById: string;
}

/**
 * Tenant-scoped repository for `rules`.
 *
 * Every public method requires `organizationId` (TenantId) and filters on it.
 * Active rules are ordered by ascending priority (lowest = evaluated first).
 */
@Injectable()
export class RuleRepository {
  constructor(
    @InjectRepository(RuleEntity)
    private readonly repo: Repository<RuleEntity>,
  ) {}

  async create(input: CreateRuleInput): Promise<RuleEntity> {
    assertTenantId(input.organizationId);
    const entity = this.repo.create({
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      isActive: input.isActive ?? true,
      priority: input.priority ?? 100,
      conditions: input.conditions,
      actions: input.actions,
      createdById: input.createdById,
      updatedById: null,
    });
    return this.repo.save(entity);
  }

  async findById(organizationId: TenantId, id: string): Promise<RuleEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { organizationId, id } });
  }

  async findAll(organizationId: TenantId): Promise<RuleEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId },
      order: { priority: 'ASC', createdAt: 'ASC' },
    });
  }

  async findActive(organizationId: TenantId): Promise<RuleEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, isActive: true },
      order: { priority: 'ASC', createdAt: 'ASC' },
    });
  }

  async update(
    organizationId: TenantId,
    id: string,
    input: UpdateRuleInput,
  ): Promise<RuleEntity | null> {
    assertTenantId(organizationId);
    const entity = await this.findById(organizationId, id);
    if (!entity) return null;

    if (input.name !== undefined) entity.name = input.name;
    if (input.description !== undefined) entity.description = input.description;
    if (input.isActive !== undefined) entity.isActive = input.isActive;
    if (input.priority !== undefined) entity.priority = input.priority;
    if (input.conditions !== undefined) entity.conditions = input.conditions;
    if (input.actions !== undefined) entity.actions = input.actions;
    entity.updatedById = input.updatedById;

    return this.repo.save(entity);
  }
}
