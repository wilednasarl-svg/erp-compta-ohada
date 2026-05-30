import type { FiscalDeclarationEntity } from '../entities/fiscal-declaration.entity';
import type { FiscalParameterEntity } from '../entities/fiscal-parameter.entity';
import type { FiscalTaxBracketEntity } from '../entities/fiscal-tax-bracket.entity';
import type { SocialPayrollLineEntity } from '../entities/social-payroll-line.entity';
import {
  type FiscalBracketResponse,
  type FiscalDeclarationEnvelopeResponse,
  type FiscalDeclarationResponse,
  type FiscalParameterEnvelopeResponse,
  type FiscalParameterResponse,
  type ListFiscalBracketsResponse,
  type ListFiscalDeclarationsResponse,
  type ListFiscalParametersResponse,
  type ListSocialPayrollLinesResponse,
  type SocialPayrollLineEnvelopeResponse,
  type SocialPayrollLineResponse,
  type SocialPeriodSummaryResponse,
} from '../dto/responses';
import type { SocialPeriodSummary } from '../services/social-payroll.service';

export function toFiscalParameterResponse(entity: FiscalParameterEntity): FiscalParameterResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    taxCode: entity.taxCode,
    label: entity.label,
    declarationKind: entity.declarationKind,
    rate: entity.rate,
    baseKind: entity.baseKind,
    periodicity: entity.periodicity,
    ceiling: entity.ceiling,
    floorAmount: entity.floorAmount,
    dueDay: entity.dueDay,
    chargeAccount: entity.chargeAccount,
    liabilityAccount: entity.liabilityAccount,
    effectiveFrom: entity.effectiveFrom,
    effectiveTo: entity.effectiveTo,
    isActive: entity.isActive,
    notes: entity.notes,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toFiscalParameterEnvelope(
  entity: FiscalParameterEntity,
): FiscalParameterEnvelopeResponse {
  return { parameter: toFiscalParameterResponse(entity) };
}

export function toListFiscalParameters(
  entities: readonly FiscalParameterEntity[],
): ListFiscalParametersResponse {
  return { parameters: entities.map(toFiscalParameterResponse) };
}

export function toFiscalDeclarationResponse(
  entity: FiscalDeclarationEntity,
): FiscalDeclarationResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    taxCode: entity.taxCode,
    label: entity.label,
    periodYear: entity.periodYear,
    periodMonth: entity.periodMonth,
    baseAmount: entity.baseAmount,
    rate: entity.rate,
    amountDue: entity.amountDue,
    currency: entity.currency,
    dueDate: entity.dueDate,
    status: entity.status,
    reference: entity.reference,
    justificatifUrl: entity.justificatifUrl,
    chargeAccount: entity.chargeAccount,
    liabilityAccount: entity.liabilityAccount,
    comment: entity.comment,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toFiscalDeclarationEnvelope(
  entity: FiscalDeclarationEntity,
): FiscalDeclarationEnvelopeResponse {
  return { declaration: toFiscalDeclarationResponse(entity) };
}

export function toListFiscalDeclarations(
  entities: readonly FiscalDeclarationEntity[],
  total: number,
): ListFiscalDeclarationsResponse {
  return { declarations: entities.map(toFiscalDeclarationResponse), total };
}

export function toFiscalBracketResponse(entity: FiscalTaxBracketEntity): FiscalBracketResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    taxCode: entity.taxCode,
    effectiveFrom: entity.effectiveFrom,
    bracketOrder: entity.bracketOrder,
    fromAmount: entity.fromAmount,
    toAmount: entity.toAmount,
    rate: entity.rate,
  };
}

export function toListFiscalBrackets(
  entities: readonly FiscalTaxBracketEntity[],
): ListFiscalBracketsResponse {
  return { brackets: entities.map(toFiscalBracketResponse) };
}

export function toSocialPayrollLineResponse(
  entity: SocialPayrollLineEntity,
): SocialPayrollLineResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    periodYear: entity.periodYear,
    periodMonth: entity.periodMonth,
    employeeRef: entity.employeeRef,
    grossSalary: entity.grossSalary,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toSocialPayrollLineEnvelope(
  entity: SocialPayrollLineEntity,
): SocialPayrollLineEnvelopeResponse {
  return { line: toSocialPayrollLineResponse(entity) };
}

export function toListSocialPayrollLines(
  entities: readonly SocialPayrollLineEntity[],
): ListSocialPayrollLinesResponse {
  return { lines: entities.map(toSocialPayrollLineResponse) };
}

export function toSocialPeriodSummaryResponse(
  summary: SocialPeriodSummary,
): SocialPeriodSummaryResponse {
  return {
    periodYear: summary.periodYear,
    periodMonth: summary.periodMonth,
    employeeCount: summary.employeeCount,
    grossTotal: summary.grossTotal,
    contributions: summary.contributions.map((c) => ({
      taxCode: c.taxCode,
      label: c.label,
      base: c.base,
      amountDue: c.amountDue,
      mode: c.mode,
    })),
    totalDue: summary.totalDue,
  };
}
