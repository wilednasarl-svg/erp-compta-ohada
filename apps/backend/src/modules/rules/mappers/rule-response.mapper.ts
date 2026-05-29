import type { RuleExecutionEntity } from '../entities/rule-execution.entity';
import type { RuleEntity } from '../entities/rule.entity';
import type { RuleExecutionResult } from '../types/rule.types';
import {
  type ListRuleExecutionsResponse,
  type ListRulesResponse,
  type RuleEnvelopeResponse,
  type RuleExecutionEntityResponse,
  type RuleExecutionResultResponse,
  type RuleResponse,
} from '../dto/responses';

export function toRuleResponse(entity: RuleEntity): RuleResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    name: entity.name,
    description: entity.description,
    isActive: entity.isActive,
    priority: entity.priority,
    conditions: entity.conditions,
    actions: entity.actions,
    createdById: entity.createdById,
    updatedById: entity.updatedById,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toRuleEnvelope(entity: RuleEntity): RuleEnvelopeResponse {
  return { rule: toRuleResponse(entity) };
}

export function toListRules(entities: RuleEntity[]): ListRulesResponse {
  return { rules: entities.map(toRuleResponse) };
}

export function toRuleExecutionResponse(entity: RuleExecutionEntity): RuleExecutionEntityResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    ruleId: entity.ruleId,
    mode: entity.mode,
    scope: entity.scope,
    matchedCount: entity.matchedCount,
    appliedCount: entity.appliedCount,
    transformationIds: entity.transformationIds,
    matchesSnapshot: entity.matchesSnapshot,
    error: entity.error,
    executedById: entity.executedById,
    createdAt: entity.createdAt,
  };
}

export function toListRuleExecutions(entities: RuleExecutionEntity[]): ListRuleExecutionsResponse {
  return { executions: entities.map(toRuleExecutionResponse) };
}

export function toRuleExecutionResult(result: RuleExecutionResult): RuleExecutionResultResponse {
  return {
    ruleId: result.ruleId,
    mode: result.mode,
    matchedCount: result.matchedCount,
    appliedCount: result.appliedCount,
    matches: result.matches,
    error: result.error,
  };
}
