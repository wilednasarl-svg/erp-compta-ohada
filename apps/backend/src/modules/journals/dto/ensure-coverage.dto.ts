import { IsEnum, IsOptional, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { FiscalYearSplit } from '../types/journal.types';

/**
 * Paramètres de création des exercices couvrant une plage de dates — utilisé
 * pour qu'un import (export Sage, balance) crée automatiquement les exercices
 * manquants couvrant les dates des écritures importées.
 */
export class EnsureCoverageDto {
  @ApiProperty({ example: '2025-01-01', description: 'Première date à couvrir (YYYY-MM-DD).' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate!: string;

  @ApiProperty({ example: '2025-12-31', description: 'Dernière date à couvrir (YYYY-MM-DD).' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'toDate must be YYYY-MM-DD' })
  toDate!: string;

  @ApiProperty({
    enum: ['MONTHLY', 'QUARTERLY', 'ANNUAL_ONLY'],
    required: false,
    default: 'MONTHLY',
    description: 'Découpage des sous-périodes des exercices créés (défaut : MONTHLY).',
  })
  @IsOptional()
  @IsEnum(['MONTHLY', 'QUARTERLY', 'ANNUAL_ONLY'])
  split?: FiscalYearSplit;
}

/** Query d'analyse de couverture (lecture seule, ne crée rien). */
export class CoverageQueryDto {
  @ApiProperty({ example: '2025-01-01', description: 'Première date à analyser (YYYY-MM-DD).' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate!: string;

  @ApiProperty({ example: '2025-12-31', description: 'Dernière date à analyser (YYYY-MM-DD).' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'toDate must be YYYY-MM-DD' })
  toDate!: string;
}
