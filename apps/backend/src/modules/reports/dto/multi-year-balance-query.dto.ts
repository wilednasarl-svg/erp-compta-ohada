import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/**
 * Balance pluri-exercices : 2 à 5 périodes côte à côte. Les périodes
 * sont passées en query parameters sériés `period1FromDate=...`
 * `period1ToDate=...` jusqu'à `period5*` (encoding sans tableau natif
 * dans Express). Les périodes utilisées sont contiguës à partir de 1.
 */
export class MultiYearBalanceQueryDto {
  @ApiProperty({ example: '2024-01-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period1FromDate!: string;

  @ApiProperty({ example: '2024-12-31' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period1ToDate!: string;

  @ApiProperty({ example: '2025-01-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period2FromDate!: string;

  @ApiProperty({ example: '2025-12-31' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period2ToDate!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period3FromDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period3ToDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period4FromDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period4ToDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period5FromDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period5ToDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  accountClass?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  accountCodeFrom?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  accountCodeTo?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  hideEmpty?: boolean;
}
