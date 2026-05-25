import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { RATE_SOURCES, type RateSource } from '../types/currency.types';

export class CreateExchangeRateDto {
  @ApiProperty({ description: 'Code ISO 4217 source', example: 'EUR' })
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'fromCurrencyCode must be 3 uppercase letters' })
  fromCurrencyCode!: string;

  @ApiProperty({ description: 'Code ISO 4217 cible', example: 'XOF' })
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'toCurrencyCode must be 3 uppercase letters' })
  toCurrencyCode!: string;

  @ApiProperty({ description: 'Date du taux (YYYY-MM-DD)', example: '2026-05-25' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'rateDate must be YYYY-MM-DD' })
  rateDate!: string;

  @ApiProperty({
    description: "1 fromCurrency = N toCurrency (jusqu'à 10 décimales)",
    example: '655.957',
  })
  @IsString()
  @IsNotEmpty()
  @IsNumberString()
  rate!: string;

  @ApiPropertyOptional({
    description: 'Source du taux',
    enum: RATE_SOURCES,
    default: 'manual',
  })
  @IsOptional()
  @IsIn(RATE_SOURCES as readonly string[])
  source?: RateSource;

  @ApiPropertyOptional({ description: 'Référence externe (URL, batch_id…)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceRef?: string;
}
