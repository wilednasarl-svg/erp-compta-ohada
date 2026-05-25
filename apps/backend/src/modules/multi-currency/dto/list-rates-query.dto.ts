import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import { RATE_SOURCES, type RateSource } from '../types/currency.types';

export class ListRatesQueryDto {
  @ApiPropertyOptional({ example: 'EUR' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  fromCurrencyCode?: string;

  @ApiPropertyOptional({ example: 'XOF' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  toCurrencyCode?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toDate?: string;

  @ApiPropertyOptional({ enum: RATE_SOURCES })
  @IsOptional()
  @IsIn(RATE_SOURCES as readonly string[])
  source?: RateSource;

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
