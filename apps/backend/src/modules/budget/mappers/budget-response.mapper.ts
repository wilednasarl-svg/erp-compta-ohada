import type { BudgetAxisEntity } from '../entities/budget-axis.entity';
import type { BudgetLineEntity } from '../entities/budget-line.entity';
import {
  type BudgetAxisEnvelopeResponse,
  type BudgetAxisResponse,
  type BudgetLineEnvelopeResponse,
  type BudgetLineResponse,
  type ListBudgetAxesResponse,
  type ListBudgetLinesResponse,
} from '../dto/responses';

/**
 * Mappers purs entité TypeORM → DTO de réponse. Aucune mutation de la
 * source, aucun side-effect (voir convention module TVA).
 */

export function toBudgetAxisResponse(entity: BudgetAxisEntity): BudgetAxisResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    axisType: entity.axisType,
    code: entity.code,
    label: entity.label,
    parentId: entity.parentId,
    isActive: entity.isActive,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toBudgetAxisEnvelope(entity: BudgetAxisEntity): BudgetAxisEnvelopeResponse {
  return { axis: toBudgetAxisResponse(entity) };
}

export function toListBudgetAxes(entities: readonly BudgetAxisEntity[]): ListBudgetAxesResponse {
  return { axes: entities.map(toBudgetAxisResponse) };
}

export function toBudgetLineResponse(entity: BudgetLineEntity): BudgetLineResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    fiscalYear: entity.fiscalYear,
    periodMonth: entity.periodMonth,
    budgetType: entity.budgetType,
    scenario: entity.scenario,
    accountCode: entity.accountCode,
    accountLabel: entity.accountLabel,
    costCenterAxisId: entity.costCenterAxisId,
    projectAxisId: entity.projectAxisId,
    agencyAxisId: entity.agencyAxisId,
    productAxisId: entity.productAxisId,
    amount: entity.amount,
    currency: entity.currency,
    exchangeRate: entity.exchangeRate,
    amountBase: entity.amountBase,
    comment: entity.comment,
    hypothesis: entity.hypothesis,
    status: entity.status,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toBudgetLineEnvelope(entity: BudgetLineEntity): BudgetLineEnvelopeResponse {
  return { line: toBudgetLineResponse(entity) };
}

export function toListBudgetLines(
  entities: readonly BudgetLineEntity[],
  total: number,
): ListBudgetLinesResponse {
  return { lines: entities.map(toBudgetLineResponse), total };
}
