import type { AssetEntity } from '../entities/asset.entity';
import type { DepreciationScheduleEntity } from '../entities/depreciation-schedule.entity';
import type { DisposalJournalEntrySummary } from '../services/assets.service';
import {
  AssetDisposalResponse,
  AssetEnvelopeResponse,
  AssetResponse,
  AssetWithScheduleResponse,
  DepreciationScheduleResponse,
  DisposalJournalEntryResponse,
  ListAssetsResponse,
  ListSchedulesResponse,
  ScheduleEnvelopeResponse,
} from '../dto/responses';

/**
 * Mappers purs entité TypeORM -> DTO de réponse OpenAPI pour les
 * immobilisations. Forme JSON strictement préservée par rapport au
 * comportement pré-DTO (sérialisation TypeORM directe).
 *
 * Voir tva/mappers/tva-response.mapper.ts pour le pattern de référence.
 */

export function toAssetResponse(entity: AssetEntity): AssetResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    code: entity.code,
    label: entity.label,
    acquisitionDate: entity.acquisitionDate,
    putInServiceDate: entity.putInServiceDate,
    acquisitionCost: entity.acquisitionCost,
    residualValue: entity.residualValue,
    depreciationMethod: entity.depreciationMethod,
    durationMonths: entity.durationMonths,
    decliningRate: entity.decliningRate,
    assetAccountId: entity.assetAccountId,
    depreciationAccountId: entity.depreciationAccountId,
    expenseAccountId: entity.expenseAccountId,
    status: entity.status,
    disposalDate: entity.disposalDate,
    disposalValue: entity.disposalValue,
    totalUnits: entity.totalUnits,
    unitsPerYear: entity.unitsPerYear,
    derogatoryEnabled: entity.derogatoryEnabled,
    derogatoryFiscalMethod: entity.derogatoryFiscalMethod,
    derogatoryFiscalDuration: entity.derogatoryFiscalDuration,
    derogatoryFiscalDecliningRate: entity.derogatoryFiscalDecliningRate,
    createdById: entity.createdById,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toDepreciationScheduleResponse(
  entity: DepreciationScheduleEntity,
): DepreciationScheduleResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    assetId: entity.assetId,
    fiscalYear: entity.fiscalYear,
    periodStart: entity.periodStart,
    periodEnd: entity.periodEnd,
    depreciationAmount: entity.depreciationAmount,
    cumulativeDepreciation: entity.cumulativeDepreciation,
    netBookValue: entity.netBookValue,
    status: entity.status,
    journalEntryId: entity.journalEntryId,
    postedAt: entity.postedAt,
    postedById: entity.postedById,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toDisposalJournalEntryResponse(
  summary: DisposalJournalEntrySummary,
): DisposalJournalEntryResponse {
  return {
    id: summary.id,
    type: summary.type,
    lines: summary.lines.map((l) => ({
      accountCode: l.accountCode,
      debit: l.debit,
      credit: l.credit,
    })),
  };
}

// ─── Enveloppes ───────────────────────────────────────────────────────

export function toListAssets(
  entities: ReadonlyArray<AssetEntity>,
): ListAssetsResponse {
  return { assets: entities.map(toAssetResponse) };
}

export function toAssetEnvelope(entity: AssetEntity): AssetEnvelopeResponse {
  return { asset: toAssetResponse(entity) };
}

export function toListSchedules(
  entities: ReadonlyArray<DepreciationScheduleEntity>,
): ListSchedulesResponse {
  return { schedule: entities.map(toDepreciationScheduleResponse) };
}

export function toScheduleEnvelope(
  entity: DepreciationScheduleEntity,
): ScheduleEnvelopeResponse {
  return { schedule: toDepreciationScheduleResponse(entity) };
}

export function toAssetWithSchedule(
  asset: AssetEntity,
  schedule: ReadonlyArray<DepreciationScheduleEntity>,
): AssetWithScheduleResponse {
  return {
    asset: toAssetResponse(asset),
    schedule: schedule.map(toDepreciationScheduleResponse),
  };
}

export function toAssetDisposal(
  asset: AssetEntity,
  journalEntries: ReadonlyArray<DisposalJournalEntrySummary>,
): AssetDisposalResponse {
  return {
    asset: toAssetResponse(asset),
    journalEntries: journalEntries.map(toDisposalJournalEntryResponse),
  };
}
