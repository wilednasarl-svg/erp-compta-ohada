import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { RuleEntity } from '../entities/rule.entity';
import { RuleExecutionRepository } from '../repositories/rule-execution.repository';
import { RuleRepository } from '../repositories/rule.repository';
import type { RuleAction, RuleCondition } from '../types/rule.types';
import { RuleExecutionEntity } from '../entities/rule-execution.entity';

export interface CreateRuleArgs {
  readonly name: string;
  readonly description?: string | null;
  readonly isActive?: boolean;
  readonly priority?: number;
  readonly conditions: RuleCondition[];
  readonly actions: RuleAction[];
}

export interface UpdateRuleArgs {
  readonly name?: string;
  readonly description?: string | null;
  readonly isActive?: boolean;
  readonly priority?: number;
  readonly conditions?: RuleCondition[];
  readonly actions?: RuleAction[];
}

/**
 * `RulesService` — CRUD operations for rules.
 *
 * Distinct from `RuleEngineService` which handles evaluate/simulate/apply.
 * Keeps the two concerns separate: data management vs. execution logic.
 */
@Injectable()
export class RulesService {
  private static readonly MODULE = 'rules' as const;
  private readonly logger = new Logger(RulesService.name);

  constructor(
    private readonly ruleRepo: RuleRepository,
    private readonly executionRepo: RuleExecutionRepository,
    private readonly audit: AuditTrailService,
  ) {}

  async createRule(
    organizationId: TenantId,
    actorId: string,
    args: CreateRuleArgs,
    ctx: AuditContext,
  ): Promise<RuleEntity> {
    assertTenantId(organizationId);
    this.validateRuleDefinition(args.conditions, args.actions);

    const rule = await this.ruleRepo.create({
      organizationId,
      name: args.name,
      description: args.description,
      isActive: args.isActive,
      priority: args.priority,
      conditions: args.conditions,
      actions: args.actions,
      createdById: actorId,
    });

    await this.emitAudit('rule_created', rule, ctx);
    return rule;
  }

  async listRules(organizationId: TenantId): Promise<RuleEntity[]> {
    assertTenantId(organizationId);
    return this.ruleRepo.findAll(organizationId);
  }

  async getRule(organizationId: TenantId, ruleId: string): Promise<RuleEntity> {
    assertTenantId(organizationId);
    const rule = await this.ruleRepo.findById(organizationId, ruleId);
    if (!rule) {
      throw new AppException(ERROR_CODES.RULE_NOT_FOUND, `Rule '${ruleId}' not found.`);
    }
    return rule;
  }

  async updateRule(
    organizationId: TenantId,
    actorId: string,
    ruleId: string,
    args: UpdateRuleArgs,
    ctx: AuditContext,
  ): Promise<RuleEntity> {
    assertTenantId(organizationId);

    if (args.conditions !== undefined || args.actions !== undefined) {
      this.validateRuleDefinition(
        args.conditions ?? [],
        args.actions ?? [],
      );
    }

    const updated = await this.ruleRepo.update(organizationId, ruleId, {
      ...args,
      updatedById: actorId,
    });

    if (!updated) {
      throw new AppException(ERROR_CODES.RULE_NOT_FOUND, `Rule '${ruleId}' not found.`);
    }

    await this.emitAudit('rule_updated', updated, ctx, args);
    return updated;
  }

  async getExecutionHistory(
    organizationId: TenantId,
    ruleId: string,
  ): Promise<RuleExecutionEntity[]> {
    assertTenantId(organizationId);
    // Verify the rule belongs to this org first.
    await this.getRule(organizationId, ruleId);
    return this.executionRepo.findByRule(organizationId, ruleId);
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  private validateRuleDefinition(conditions: RuleCondition[], actions: RuleAction[]): void {
    const validConditionTypes = new Set([
      'account_prefix',
      'account_in',
      'journal_in',
      'amount_range',
      'label_contains',
      'date_range',
    ]);

    const validActionTypes = new Set([
      'reclassify_account',
      'reclassify_journal',
      'assign_cost_center',
      'add_tag',
    ]);

    for (const cond of conditions) {
      if (!validConditionTypes.has(cond.type)) {
        throw new AppException(
          ERROR_CODES.RULE_INVALID_CONDITION,
          `Unknown condition type: '${cond.type}'.`,
        );
      }
    }

    for (const action of actions) {
      if (!validActionTypes.has(action.type)) {
        throw new AppException(
          ERROR_CODES.RULE_INVALID_ACTION,
          `Unknown action type: '${action.type}'.`,
        );
      }
    }

    if (actions.length === 0) {
      throw new AppException(
        ERROR_CODES.RULE_INVALID_ACTION,
        'A rule must have at least one action.',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Audit helpers
  // ---------------------------------------------------------------------------

  private async emitAudit(
    action: string,
    rule: RuleEntity,
    ctx: AuditContext,
    changes?: Partial<UpdateRuleArgs>,
  ): Promise<void> {
    try {
      await this.audit.record({
        module: RulesService.MODULE,
        action,
        entityType: 'rule',
        entityId: rule.id,
        after: {
          name: rule.name,
          isActive: rule.isActive,
          priority: rule.priority,
          conditionCount: rule.conditions.length,
          actionCount: rule.actions.length,
        },
        ...(changes ? { before: changes as Record<string, unknown> } : {}),
        ctx,
      });
    } catch (err) {
      this.logger.warn(`Audit emission failed for rule ${rule.id}: ${err}`);
    }
  }
}
