import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/**
 * Fenêtre [fromDate, toDate] de l'indice de validité pré-génération (AC-V5).
 * Pour un état `as-at` (Bilan), le client passe le début d'exercice et la date
 * d'arrêté ; pour un état `range`, les bornes Du/Au telles quelles.
 */
export class PeriodValidityQueryDto {
  @ApiProperty({ example: '2026-01-01', description: 'Start of the period (inclusive)' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate!: string;

  @ApiProperty({ example: '2026-12-31', description: 'End of the period (inclusive)' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'toDate must be YYYY-MM-DD' })
  toDate!: string;
}
