import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  FISCAL_BASE_KINDS,
  FISCAL_PERIODICITIES,
  type FiscalBaseKind,
  type FiscalDeclarationKind,
  type FiscalPeriodicity,
} from '../types/fiscal.types';

const KINDS: readonly string[] = ['fiscal', 'social'];

export class CreateFiscalParameterDto {
  @ApiProperty({ example: 'TVA' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9_]{1,32}$/)
  taxCode!: string;

  @ApiProperty({ example: 'TVA (taux normal)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  @ApiProperty({ enum: KINDS })
  @IsIn(KINDS)
  declarationKind!: FiscalDeclarationKind;

  @ApiProperty({ example: '18.0000', description: 'Taux en % (NUMERIC 8,4)' })
  @IsNumberString({ no_symbols: false })
  @Matches(/^\d{1,4}(\.\d{1,4})?$/)
  rate!: string;

  @ApiProperty({ enum: FISCAL_BASE_KINDS as readonly string[] })
  @IsIn(FISCAL_BASE_KINDS as readonly string[])
  baseKind!: FiscalBaseKind;

  @ApiProperty({ enum: FISCAL_PERIODICITIES as readonly string[] })
  @IsIn(FISCAL_PERIODICITIES as readonly string[])
  periodicity!: FiscalPeriodicity;

  @ApiPropertyOptional({ example: '70000.00', description: 'Plafond de base' })
  @IsOptional()
  @IsNumberString({ no_symbols: false })
  @Matches(/^\d{1,16}(\.\d{1,2})?$/)
  ceiling?: string;

  @ApiPropertyOptional({ example: 15, description: 'Jour limite de dépôt (1-31)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number;

  @ApiPropertyOptional({ example: '4434', description: 'Compte de charge' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{1,12}$/)
  chargeAccount?: string;

  @ApiPropertyOptional({ example: '4431', description: 'Compte de dette (État/CNPS)' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{1,12}$/)
  liabilityAccount?: string;

  @ApiProperty({ example: '2026-01-01', description: "Date d'effet (AAAA-MM-JJ)" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Fin de validité' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveTo?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Notes / base légale' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
