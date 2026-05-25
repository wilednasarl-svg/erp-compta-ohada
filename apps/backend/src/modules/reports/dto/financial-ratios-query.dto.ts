import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/**
 * Ratios financiers — calculés "as at" une date (bilan) + sur la
 * période [fiscalYearStartDate, asAtDate] (SIG pour le CR).
 */
export class FinancialRatiosQueryDto {
  @ApiProperty({ example: '2026-12-31', description: 'Date de calcul des ratios' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'asAtDate must be YYYY-MM-DD' })
  asAtDate!: string;

  @ApiProperty({
    example: '2026-01-01',
    description: "Début de l'exercice fiscal (sert au calcul du SIG)",
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fiscalYearStartDate must be YYYY-MM-DD',
  })
  fiscalYearStartDate!: string;
}
