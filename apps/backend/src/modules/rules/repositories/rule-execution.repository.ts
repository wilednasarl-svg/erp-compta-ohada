import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { RuleExecutionEntity, type RuleExecutionMode } from '../entities/rule-execution.entity';
import type { RuleMatch, RuleScope } from '../types/rule.types';

export interface CreateRuleExecutionInput {
  readonly organizationId: TenantId;
  readonly ruleId: string;
  readonly mode: RuleExecutionMode;
  readonly scope: RuleScope;
  readonly matchedCount: number;
  readonly appliedCount: number;
  readonly transformationIds: string[];
  readonly matchesSnapshot: RuleMatch[];
  readonly error?: string | null;
  readonly executedById: string;
}

@Injectable()
export class RuleExecutionRepository {
  constructor(
    @InjectRepository(RuleExecutionEntity)
    private readonly repo: Repository<RuleExecutionEntity>,
  ) {}

  async create(input: CreateRuleExecutionInput): Promise<RuleExecutionEntity> {
    assertTenantId(input.organizationId);
    const entity = this.repo.create({
      organizationId: input.organizationId,
      ruleId: input.ruleId,
      mode: input.mode,
      scope: input.scope,
      matchedCount: input.matchedCount,
      appliedCount: input.appliedCount,
      transformationIds: input.transformationIds,
      matchesSnapshot: input.matchesSnapshot,
      error: input.error ?? null,
      executedById: input.executedById,
    });
    return this.repo.save(entity);
  }

  async findByRule(
    organizationId: TenantId,
    ruleId: string,
    limit = 50,
  ): Promise<RuleExecutionEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, ruleId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
