import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { ImportStagingEntryEntity } from '../../imports/entities/import-staging-entry.entity';
import { ImportSessionEntity } from '../../imports/entities/import-session.entity';
import { TransformationService } from '../../transformations/services/transformation.service';
import { RuleEntity } from '../entities/rule.entity';
import { RuleExecutionRepository } from '../repositories/rule-execution.repository';
import { RuleRepository } from '../repositories/rule.repository';
import type {
  AmountRangeCondition,
  RuleAction,
  RuleCondition,
  RuleExecutionResult,
  RuleMatch,
  RuleScope,
} from '../types/rule.types';

export type { RuleExecutionResult, RuleMatch, RuleScope };

/**
 * `RuleEngineService` — Module 5 Rule Engine (wave 1).
 *
 * Trois opérations publiques :
 *
 *   `evaluateRuleOnEntry` — évaluation sans side effect d'une règle sur
 *     une écriture. Retourne les actions qui seraient appliquées (ou []
 *     si l'écriture ne satisfait pas les conditions). Utilisé en interne
 *     par simulate et apply.
 *
 *   `simulateRules` — pour un périmètre d'écritures, retourne le plan
 *     d'exécution (matched entries + actions) sans rien modifier. Enregistre
 *     une `rule_execution` avec mode='simulation'.
 *
 *   `applyRules` — applique réellement les actions via TransformationService
 *     (Module 4). Chaque action devient une `entry_transformation` traçable.
 *     Enregistre une `rule_execution` avec mode='apply'.
 *
 * Invariant : les écritures sources (`import_staging_entries`) ne sont
 * JAMAIS modifiées directement. Toute modification passe par
 * TransformationService.
 */
@Injectable()
export class RuleEngineService {
  private static readonly MODULE = 'rules' as const;
  private readonly logger = new Logger(RuleEngineService.name);

  constructor(
    private readonly ruleRepo: RuleRepository,
    private readonly executionRepo: RuleExecutionRepository,
    @InjectRepository(ImportStagingEntryEntity)
    private readonly stagingRepo: Repository<ImportStagingEntryEntity>,
    private readonly transformations: TransformationService,
    private readonly audit: AuditTrailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Pure evaluation of a rule against a single entry — no side effects.
   * Returns the list of actions that would be applied.
   * Returns [] if the entry does not satisfy all conditions.
   */
  evaluateRuleOnEntry(rule: RuleEntity, entry: ImportStagingEntryEntity): RuleAction[] {
    const allMatch = rule.conditions.every((cond) => this.matchesCondition(cond, entry));
    return allMatch ? rule.actions : [];
  }

  /**
   * Simulate a rule on a scope — returns what WOULD be applied without
   * creating any transformations.
   */
  async simulateRules(
    organizationId: TenantId,
    ruleId: string,
    scope: RuleScope,
    actorId: string,
    ctx: AuditContext,
  ): Promise<RuleExecutionResult> {
    assertTenantId(organizationId);
    const rule = await this.resolveRule(organizationId, ruleId);
    const entries = await this.fetchEntries(organizationId, scope);

    const matches: RuleMatch[] = [];
    for (const entry of entries) {
      const actions = this.evaluateRuleOnEntry(rule, entry);
      if (actions.length > 0) {
        matches.push({ entryId: entry.id, actions, transformationIds: null });
      }
    }

    const result: RuleExecutionResult = {
      ruleId,
      mode: 'simulation',
      matchedCount: matches.length,
      appliedCount: 0,
      matches,
    };

    await this.persistExecution(organizationId, rule, scope, result, actorId);
    await this.emitAudit('rule_simulated', rule, result, ctx);

    return result;
  }

  /**
   * Apply a rule on a scope — creates `entry_transformations` via
   * TransformationService for each matched entry. Entries that generate
   * no actions are silently skipped.
   */
  async applyRules(
    organizationId: TenantId,
    ruleId: string,
    scope: RuleScope,
    actorId: string,
    ctx: AuditContext,
  ): Promise<RuleExecutionResult> {
    assertTenantId(organizationId);
    const rule = await this.resolveRule(organizationId, ruleId);
    const entries = await this.fetchEntries(organizationId, scope);

    const matches: RuleMatch[] = [];
    let applyError: string | undefined;

    for (const entry of entries) {
      const actions = this.evaluateRuleOnEntry(rule, entry);
      if (actions.length === 0) continue;

      const transformationIds: string[] = [];
      try {
        for (const action of actions) {
          const trf = await this.applyAction(organizationId, actorId, entry, action, rule, ctx);
          if (trf) transformationIds.push(trf);
        }
        matches.push({ entryId: entry.id, actions, transformationIds });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Rule ${ruleId} failed to apply to entry ${entry.id}: ${msg}`,
        );
        applyError = applyError ?? msg;
        // Continue processing remaining entries even if one fails.
        matches.push({ entryId: entry.id, actions, transformationIds });
      }
    }

    const allTrfIds = matches.flatMap((m) => m.transformationIds ?? []);

    const result: RuleExecutionResult = {
      ruleId,
      mode: 'apply',
      matchedCount: matches.length,
      appliedCount: matches.filter((m) => (m.transformationIds?.length ?? 0) > 0).length,
      matches,
      ...(applyError ? { error: applyError } : {}),
    };

    await this.persistExecution(organizationId, rule, scope, result, actorId, allTrfIds);
    await this.emitAudit('rule_applied', rule, result, ctx);

    return result;
  }

  // ---------------------------------------------------------------------------
  // Condition evaluation
  // ---------------------------------------------------------------------------

  private matchesCondition(
    cond: RuleCondition,
    entry: ImportStagingEntryEntity,
  ): boolean {
    const mv = entry.mappedValues;

    switch (cond.type) {
      case 'account_prefix': {
        const acct = mv.account ?? '';
        return acct.startsWith(cond.prefix);
      }

      case 'account_in': {
        const acct = mv.account ?? '';
        return cond.accounts.includes(acct);
      }

      case 'journal_in': {
        const journal = mv.journal ?? '';
        return cond.journals.includes(journal);
      }

      case 'amount_range': {
        return this.matchesAmountRange(cond, mv);
      }

      case 'label_contains': {
        const label = (mv.label ?? '').toLowerCase();
        return label.includes(cond.substring.toLowerCase());
      }

      case 'date_range': {
        const date = mv.date;
        if (!date) return false;
        if (cond.from && date < cond.from) return false;
        if (cond.to && date > cond.to) return false;
        return true;
      }

      default:
        return false;
    }
  }

  private matchesAmountRange(
    cond: AmountRangeCondition,
    mv: ImportStagingEntryEntity['mappedValues'],
  ): boolean {
    const getAmount = (field: 'debit' | 'credit'): number => {
      const raw = mv[field];
      if (!raw) return 0;
      const n = parseFloat(raw);
      return isNaN(n) ? 0 : n;
    };

    let amount: number;
    switch (cond.side) {
      case 'debit':
        amount = getAmount('debit');
        break;
      case 'credit':
        amount = getAmount('credit');
        break;
      case 'any':
        amount = Math.max(getAmount('debit'), getAmount('credit'));
        break;
    }

    if (cond.min !== undefined && amount < cond.min) return false;
    if (cond.max !== undefined && amount > cond.max) return false;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Action application
  // ---------------------------------------------------------------------------

  /**
   * Translates a single RuleAction into a TransformationService call.
   * Returns the transformation ID created, or null if no transformation
   * was needed (e.g. add_tag writes to notes only).
   */
  private async applyAction(
    organizationId: TenantId,
    actorId: string,
    entry: ImportStagingEntryEntity,
    action: RuleAction,
    rule: RuleEntity,
    ctx: AuditContext,
  ): Promise<string | null> {
    switch (action.type) {
      case 'reclassify_account': {
        const trf = await this.transformations.reclassifyEntry(
          organizationId,
          actorId,
          {
            sourceEntryId: entry.id,
            account: action.targetAccount,
            notes: `Règle automatique: ${rule.name}`,
          },
          ctx,
        );
        return trf.id;
      }

      case 'reclassify_journal': {
        const trf = await this.transformations.reclassifyEntry(
          organizationId,
          actorId,
          {
            sourceEntryId: entry.id,
            journal: action.targetJournal,
            notes: `Règle automatique: ${rule.name}`,
          },
          ctx,
        );
        return trf.id;
      }

      case 'assign_cost_center': {
        // Cost center stored as a label correction (partner field in wave 1).
        // Wave 2 will introduce a dedicated cost_center column.
        const trf = await this.transformations.reclassifyEntry(
          organizationId,
          actorId,
          {
            sourceEntryId: entry.id,
            partner: action.costCenter,
            notes: `Règle automatique (centre de coûts): ${rule.name}`,
          },
          ctx,
        );
        return trf.id;
      }

      case 'add_tag': {
        // Tags are stored as notes on the reclassification transformation.
        const trf = await this.transformations.reclassifyEntry(
          organizationId,
          actorId,
          {
            sourceEntryId: entry.id,
            label: `${entry.mappedValues.label ?? ''} [${action.tag}]`.trim(),
            notes: `Règle automatique (tag: ${action.tag}): ${rule.name}`,
          },
          ctx,
        );
        return trf.id;
      }

      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async resolveRule(organizationId: TenantId, ruleId: string): Promise<RuleEntity> {
    const rule = await this.ruleRepo.findById(organizationId, ruleId);
    if (!rule) {
      throw new AppException(
        ERROR_CODES.RULE_NOT_FOUND,
        { message: `Rule '${ruleId}' not found or does not belong to this organization.` },
      );
    }
    return rule;
  }

  /**
   * Fetch staging entries matching the scope. Scoped to the org via JOIN
   * on import_sessions to enforce tenant isolation.
   */
  private async fetchEntries(
    organizationId: TenantId,
    scope: RuleScope,
  ): Promise<ImportStagingEntryEntity[]> {
    const qb = this.stagingRepo
      .createQueryBuilder('e')
      .innerJoin(ImportSessionEntity, 's', 's.id = e.session_id AND s.organization_id = :orgId', {
        orgId: organizationId,
      });

    if (scope.importSessionId) {
      qb.andWhere('e.session_id = :sessionId', { sessionId: scope.importSessionId });
    }

    // Date and journal filters are applied post-query against mappedValues
    // (JSONB field — querying them via TypeORM is verbose; the dataset is
    // bounded by session scope anyway).
    const entries = await qb.getMany();

    return entries.filter((e) => {
      const mv = e.mappedValues;
      if (scope.journal && mv.journal !== scope.journal) return false;
      if (scope.dateFrom && (mv.date ?? '') < scope.dateFrom) return false;
      if (scope.dateTo && (mv.date ?? '') > scope.dateTo) return false;
      return true;
    });
  }

  private async persistExecution(
    organizationId: TenantId,
    rule: RuleEntity,
    scope: RuleScope,
    result: RuleExecutionResult,
    executedById: string,
    allTrfIds: string[] = [],
  ): Promise<void> {
    try {
      await this.executionRepo.create({
        organizationId,
        ruleId: rule.id,
        mode: result.mode,
        scope,
        matchedCount: result.matchedCount,
        appliedCount: result.appliedCount,
        transformationIds: allTrfIds,
        matchesSnapshot: result.matches,
        error: result.error ?? null,
        executedById,
      });
    } catch (err) {
      this.logger.error(`Failed to persist rule_execution for rule ${rule.id}: ${err}`);
    }
  }

  private async emitAudit(
    action: string,
    rule: RuleEntity,
    result: RuleExecutionResult,
    ctx: AuditContext,
  ): Promise<void> {
    try {
      await this.audit.record({
        module: RuleEngineService.MODULE,
        action,
        entityType: 'rule',
        entityId: rule.id,
        metadata: {
          ruleName: rule.name,
          mode: result.mode,
          matchedCount: result.matchedCount,
          appliedCount: result.appliedCount,
          ...(result.error ? { error: result.error } : {}),
        },
        ctx,
      });
    } catch (err) {
      this.logger.warn(`Audit emission failed for rule ${rule.id}: ${err}`);
    }
  }
}
