import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { DEPRECIATION_METHODS } from '../types/asset.types';
import type { DepreciationMethod } from '../types/asset.types';

/**
 * Patch partiel d'une immobilisation. Tous les champs sont optionnels :
 * un PATCH peut ne renommer que le label sans toucher au calcul, ou
 * inversement modifier la durée (déclenche un recompute du schedule
 * côté service).
 */
export class UpdateAssetDto {
  @ApiPropertyOptional({
    description: "Description / Libellé de l'immobilisation",
    example: 'Ordinateur Portable MacBook Pro V2',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional({ description: "Date d'acquisition (YYYY-MM-DD)", example: '2026-05-01' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'acquisitionDate must be YYYY-MM-DD' })
  acquisitionDate?: string;

  @ApiPropertyOptional({
    description: 'Date de mise en service (YYYY-MM-DD)',
    example: '2026-05-15',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'putInServiceDate must be YYYY-MM-DD' })
  putInServiceDate?: string;

  @ApiPropertyOptional({ description: "Coût d'acquisition HT", example: '1600000.00' })
  @IsOptional()
  @IsString()
  @IsNumberString()
  acquisitionCost?: string;

  @ApiPropertyOptional({
    description: 'Valeur résiduelle attendue en fin de vie',
    example: '10000.00',
  })
  @IsOptional()
  @IsString()
  @IsNumberString()
  residualValue?: string;

  @ApiPropertyOptional({
    description: "Méthode d'amortissement (linear ou declining)",
    enum: DEPRECIATION_METHODS,
  })
  @IsOptional()
  @IsIn(DEPRECIATION_METHODS as readonly string[])
  depreciationMethod?: DepreciationMethod;

  @ApiPropertyOptional({ description: "Durée d'amortissement en mois", example: 48 })
  @IsOptional()
  @IsInt()
  @Min(1)
  durationMonths?: number;

  @ApiPropertyOptional({ description: "Taux dégressif (ex: '0.3500')", example: '0.3500' })
  @IsOptional()
  @IsString()
  @IsNumberString()
  decliningRate?: string;

  @ApiPropertyOptional({
    description: "Code SYSCOHADA du compte d'immobilisation brute",
    example: '2411',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,10}$/, { message: 'assetAccountCode must be a SYSCOHADA code (digits only)' })
  assetAccountCode?: string;

  @ApiPropertyOptional({
    description: "Code SYSCOHADA du compte d'amortissement cumulé",
    example: '2841',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,10}$/, {
    message: 'depreciationAccountCode must be a SYSCOHADA code (digits only)',
  })
  depreciationAccountCode?: string;

  @ApiPropertyOptional({
    description: 'Code SYSCOHADA du compte de dotation aux amortissements',
    example: '6811',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,10}$/, { message: 'expenseAccountCode must be a SYSCOHADA code (digits only)' })
  expenseAccountCode?: string;
}
