import type { TransformationSummary } from '../services/transformation.service';
import {
  type TransformationEnvelopeResponse,
  type TransformationHistoryResponse,
  type TransformationSummaryResponse,
} from '../dto/responses';

export function toTransformationSummaryResponse(
  summary: TransformationSummary,
): TransformationSummaryResponse {
  return {
    id: summary.id,
    type: summary.type,
    status: summary.status,
    sourceEntryId: summary.sourceEntryId,
    beforeValues: summary.beforeValues,
    afterValues: summary.afterValues,
    notes: summary.notes,
    createdById: summary.createdById,
    createdAt: summary.createdAt,
    cancelledAt: summary.cancelledAt,
    cancelReason: summary.cancelReason,
  };
}

export function toTransformationEnvelope(
  summary: TransformationSummary,
): TransformationEnvelopeResponse {
  return { transformation: toTransformationSummaryResponse(summary) };
}

export function toTransformationHistory(
  summaries: TransformationSummary[],
): TransformationHistoryResponse {
  return { history: summaries.map(toTransformationSummaryResponse) };
}
