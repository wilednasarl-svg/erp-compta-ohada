import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

/**
 * POST /organizations/:id/accounting-score/recalculate.
 *
 * `exerciseId` est un `accounting_periods.id` — typiquement la période
 * ANNUAL de l'exercice, mais le service accepte aussi des QUARTERLY /
 * MONTHLY (le scoring scope sur entry_date BETWEEN start_date AND end_date).
 *
 * `referenceDate` est optionnel : utile pour rejouer un calcul historique
 * (audit, tests). Par défaut = today.
 */
export class RecalculateScoreDto {
  @ApiProperty({
    description: 'Accounting period id (ANNUAL / QUARTERLY / MONTHLY)',
    format: 'uuid',
  })
  @IsUUID('4')
  exerciseId!: string;

  @ApiProperty({
    description: 'Optional reference date (ISO YYYY-MM-DD) for "delay" criterion replay',
    required: false,
    example: '2026-05-25',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'referenceDate must be ISO YYYY-MM-DD',
  })
  referenceDate?: string;
}
