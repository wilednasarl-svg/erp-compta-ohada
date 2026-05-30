import type { FiscalDeclarationEntity } from '../entities/fiscal-declaration.entity';
import type { FiscalParameterEntity } from '../entities/fiscal-parameter.entity';
import {
  type FiscalDeclarationEnvelopeResponse,
  type FiscalDeclarationResponse,
  type FiscalParameterEnvelopeResponse,
  type FiscalParameterResponse,
  type ListFiscalDeclarationsResponse,
  type ListFiscalParametersResponse,
} from '../dto/responses';

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
