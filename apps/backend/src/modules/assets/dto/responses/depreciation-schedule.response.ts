import { ApiProperty } from '@nestjs/swagger';

import type { DepreciationStatus } from '../../types/asset.types';

const DEPRECIATION_STATUSES: ReadonlyArray<DepreciationStatus> = ['pending', 'posted'];

/**
 * Réponse API pour une ligne d'échéancier d'amortissement. Forme
 * alignée sur la sérialisation TypeORM historique de
 * `DepreciationScheduleEntity`.
 */
export class DepreciationScheduleResponse {
  @ApiProperty({ description: "UUID de la ligne d'échéancier", format: 'uuid' })
  id!: string;

  @ApiProperty({ description: "UUID de l'organisation", format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ description: "UUID de l'immobilisation", format: 'uuid' })
  assetId!: string;

  @ApiProperty({ description: 'Année fiscale (ex 2026)', type: Number })
  fiscalYear!: number;

  @ApiProperty({ description: 'Début de période (YYYY-MM-DD)', type: String })
  periodStart!: string;

  @ApiProperty({ description: 'Fin de période (YYYY-MM-DD)', type: String })
  periodEnd!: string;

  @ApiProperty({ description: 'Dotation de la période. DECIMAL(15,2) en string.', type: String })
  depreciationAmount!: string;

  @ApiProperty({
    description: "Cumul des amortissements jusqu'à la fin de période. DECIMAL(15,2) en string.",
    type: String,
  })
  cumulativeDepreciation!: string;

  @ApiProperty({ description: 'Valeur nette comptable. DECIMAL(15,2) en string.', type: String })
  netBookValue!: string;

  @ApiProperty({ description: 'Statut de la ligne', enum: DEPRECIATION_STATUSES })
  status!: DepreciationStatus;

  @ApiProperty({
    description: "UUID de l'écriture comptable (si status=posted)",
    nullable: true,
    type: String,
    format: 'uuid',
  })
  journalEntryId!: string | null;

  @ApiProperty({
    description: 'Date du posting comptable',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  postedAt!: Date | null;

  @ApiProperty({
    description: "UUID de l'utilisateur ayant posté",
    nullable: true,
    type: String,
    format: 'uuid',
  })
  postedById!: string | null;

  @ApiProperty({ description: 'Date de création', type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ description: 'Date de modification', type: String, format: 'date-time' })
  updatedAt!: Date;
}
