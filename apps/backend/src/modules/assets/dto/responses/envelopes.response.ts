import { ApiProperty } from '@nestjs/swagger';

import { AssetResponse } from './asset.response';
import { DepreciationScheduleResponse } from './depreciation-schedule.response';
import { DisposalJournalEntryResponse } from './disposal-journal-entry.response';

/**
 * Réponses enveloppes pour les endpoints de `AssetsController`. Toutes
 * les formes sont **strictement préservées** par rapport au pré-DTO
 * (le frontend lit déjà ces clés `assets`, `asset`, `schedule`, etc.).
 */

export class ListAssetsResponse {
  @ApiProperty({ description: "Toutes les immobilisations de l'org", type: () => [AssetResponse] })
  assets!: AssetResponse[];
}

export class AssetEnvelopeResponse {
  @ApiProperty({ description: "L'immobilisation", type: () => AssetResponse })
  asset!: AssetResponse;
}

export class ListSchedulesResponse {
  @ApiProperty({
    description: "Échéancier d'amortissement complet de l'immobilisation",
    type: () => [DepreciationScheduleResponse],
  })
  schedule!: DepreciationScheduleResponse[];
}

export class ScheduleEnvelopeResponse {
  @ApiProperty({
    description: "Une ligne d'échéancier postée en comptabilité",
    type: () => DepreciationScheduleResponse,
  })
  schedule!: DepreciationScheduleResponse;
}

export class AssetWithScheduleResponse {
  @ApiProperty({ description: 'Immobilisation créée ou mise à jour', type: () => AssetResponse })
  asset!: AssetResponse;

  @ApiProperty({
    description: "Échéancier d'amortissement recalculé",
    type: () => [DepreciationScheduleResponse],
  })
  schedule!: DepreciationScheduleResponse[];
}

export class AssetDisposalResponse {
  @ApiProperty({ description: 'Immobilisation cédée', type: () => AssetResponse })
  asset!: AssetResponse;

  @ApiProperty({
    description: 'Écritures comptables générées par la cession (1 à 3)',
    type: () => [DisposalJournalEntryResponse],
  })
  journalEntries!: DisposalJournalEntryResponse[];
}
