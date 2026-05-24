import { IsEnum, IsInt, IsNotEmpty, IsOptional, Matches, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { FiscalYearSplit } from '../types/journal.types';

export class CreateFiscalYearDto {
  @ApiProperty({ description: 'Annee comptable (ex: 2026)', example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @ApiProperty({
    enum: ['MONTHLY', 'QUARTERLY', 'ANNUAL_ONLY'],
    description: 'Decoupage des sous-periodes',
    example: 'MONTHLY',
  })
  @IsEnum(['MONTHLY', 'QUARTERLY', 'ANNUAL_ONLY'])
  @IsNotEmpty()
  split!: FiscalYearSplit;

  /**
   * Optional fiscal-year start date in `YYYY-MM-DD`. Omit for a
   * calendar year (Jan 1 → Dec 31 of `year`). Provide e.g.
   * `2026-04-01` for an offset fiscal year (Apr 1, 2026 → Mar 31, 2027).
   * The 12 monthly / 4 quarterly sub-periods roll forward from this date.
   */
  @ApiProperty({
    required: false,
    example: '2026-04-01',
    description: 'Optional fiscal-year start date (YYYY-MM-DD). Omit for a calendar year.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;
}
