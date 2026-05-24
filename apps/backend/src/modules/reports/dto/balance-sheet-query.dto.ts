import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class BalanceSheetQueryDto {
  @ApiProperty({
    example: '2026-12-31',
    description: 'Cumulative balance as at this date (inclusive)',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'asAtDate must be YYYY-MM-DD' })
  asAtDate!: string;

  @ApiProperty({
    required: false,
    example: '2026-01-01',
    description:
      'Optional start date of the fiscal year ending at `asAtDate`. When provided, the net result for the period [fiscalYearStartDate, asAtDate] is auto-incorporated into capitaux propres as a synthetic "Résultat de l\'exercice" line — the bilan then balances by construction.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fiscalYearStartDate must be YYYY-MM-DD' })
  fiscalYearStartDate?: string;

  @ApiProperty({
    required: false,
    example: '2025-12-31',
    description: 'Optional prior-period snapshot date for N vs N-1 comparison.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'compareAsAtDate must be YYYY-MM-DD' })
  compareAsAtDate?: string;

  @ApiProperty({
    required: false,
    example: '2025-01-01',
    description: 'Optional prior-year start date for the comparison consolidation.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'compareFiscalYearStartDate must be YYYY-MM-DD' })
  compareFiscalYearStartDate?: string;
}
