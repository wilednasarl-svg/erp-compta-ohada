import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class TrialBalanceQueryDto {
  @ApiProperty({ example: '2026-01-01', description: 'Start of the period (inclusive)' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate!: string;

  @ApiProperty({ example: '2026-12-31', description: 'End of the period (inclusive)' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'toDate must be YYYY-MM-DD' })
  toDate!: string;

  @ApiProperty({
    required: false,
    description: 'Filter accounts on their OHADA class (1-9)',
    example: 6,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  accountClass?: number;

  @ApiProperty({ required: false, description: 'Inclusive lower bound on account code' })
  @IsOptional()
  @IsString()
  accountCodeFrom?: string;

  @ApiProperty({ required: false, description: 'Inclusive upper bound on account code' })
  @IsOptional()
  @IsString()
  accountCodeTo?: string;

  @ApiProperty({
    required: false,
    description: 'Hide accounts that have no movement and no opening',
    example: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  hideEmpty?: boolean;

  @ApiProperty({
    required: false,
    description: "Type d'axe analytique (CHANTIER, BU, ACTIVITE, PROJET)",
    example: 'CHANTIER',
  })
  @IsOptional()
  @IsString()
  analyticAxisType?: string;

  @ApiProperty({
    required: false,
    description: "Code de l'axe analytique (ex. AB123)",
    example: 'AB123',
  })
  @IsOptional()
  @IsString()
  analyticAxisCode?: string;
}
