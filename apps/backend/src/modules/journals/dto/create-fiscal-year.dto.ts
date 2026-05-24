import { IsEnum, IsInt, IsNotEmpty, Max, Min } from 'class-validator';
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
}
