import type { TvaCodeEntity } from '../entities/tva-code.entity';
import type { TvaDeclarationLineEntity } from '../entities/tva-declaration-line.entity';
import type { TvaDeclarationEntity } from '../entities/tva-declaration.entity';
import {
  ListTvaCodesResponse,
  ListTvaDeclarationsResponse,
  TvaCodeEnvelopeResponse,
  TvaCodeResponse,
  TvaDeclarationEnvelopeResponse,
  TvaDeclarationLineResponse,
  TvaDeclarationResponse,
} from '../dto/responses';

/**
 * Mappers purs entité TypeORM → DTO de réponse OpenAPI.
 *
 * Règle d'or : aucune mutation de l'entité source, aucun side-effect.
 * Le mapper est le seul endroit qui connaît la forme des colonnes
 * TypeORM ; le controller manipule des DTO bien typés.
 */

export function toTvaDeclarationLineResponse(
  entity: TvaDeclarationLineEntity,
): TvaDeclarationLineResponse {
  return {
    id: entity.id,
    declarationId: entity.declarationId,
    direction: entity.direction,
    accountPrefix: entity.accountPrefix,
    accountLabel: entity.accountLabel,
    amount: entity.amount,
    createdAt: entity.createdAt,
  };
}

export function toTvaDeclarationResponse(
  entity: TvaDeclarationEntity,
): TvaDeclarationResponse {
  const lines = Array.isArray(entity.lines)
    ? entity.lines.map(toTvaDeclarationLineResponse)
    : [];

  return {
    id: entity.id,
    organizationId: entity.organizationId,
    periodYear: entity.periodYear,
    periodMonth: entity.periodMonth,
    status: entity.status,
    tvaCollecteeTotal: entity.tvaCollecteeTotal,
    tvaDeductibleBsTotal: entity.tvaDeductibleBsTotal,
    tvaDeductibleImmoTotal: entity.tvaDeductibleImmoTotal,
    tvaADecaisser: entity.tvaADecaisser,
    creditTvaReportable: entity.creditTvaReportable,
    computedAt: entity.computedAt,
    computedById: entity.computedById,
    cancelledAt: entity.cancelledAt,
    cancelledById: entity.cancelledById,
    cancelledReason: entity.cancelledReason,
    lines,
  };
}

export function toTvaCodeResponse(entity: TvaCodeEntity): TvaCodeResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    code: entity.code,
    label: entity.label,
    rate: entity.rate,
    type: entity.type,
    kind: entity.kind,
    isActive: entity.isActive,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

// ─── Enveloppes ───────────────────────────────────────────────────────

export function toListDeclarations(
  entities: ReadonlyArray<TvaDeclarationEntity>,
): ListTvaDeclarationsResponse {
  return {
    declarations: entities.map(toTvaDeclarationResponse),
  };
}

export function toEnvelopeDeclaration(
  entity: TvaDeclarationEntity,
): TvaDeclarationEnvelopeResponse {
  return {
    declaration: toTvaDeclarationResponse(entity),
  };
}

export function toListCodes(
  entities: ReadonlyArray<TvaCodeEntity>,
): ListTvaCodesResponse {
  return {
    codes: entities.map(toTvaCodeResponse),
  };
}

export function toEnvelopeCode(entity: TvaCodeEntity): TvaCodeEnvelopeResponse {
  return {
    code: toTvaCodeResponse(entity),
  };
}
