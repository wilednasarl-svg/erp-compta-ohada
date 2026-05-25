import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
 * Contract pour créer une immobilisation.
 *
 * Les 3 comptes SYSCOHADA sont référencés par leur CODE (chaîne) plutôt
 * que par UUID — c'est ce que l'utilisateur connaît ("2411" pour
 * matériel informatique, "2841" pour amortissements, "6811" pour
 * dotations). Le service résout chaque code en UUID via
 * `OrganizationAccountRepository.findByCode` au moment de la création.
 *
 * `putInServiceDate` est optionnel — par défaut on prend
 * `acquisitionDate` (les deux dates coïncident dans la majorité des cas).
 */
export class CreateAssetDto {
  @ApiProperty({
    description: "Code unique de l'immobilisation (lettres maj, chiffres, tirets ; 1-20 chars)",
    example: 'IMMO-2026-001',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9-]{1,20}$/, {
    message: 'code must only contain uppercase letters, numbers, and hyphens, up to 20 characters',
  })
  code!: string;

  @ApiProperty({
    description: "Description / Libellé de l'immobilisation",
    example: 'Ordinateur Portable MacBook Pro',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  @ApiProperty({ description: "Date d'acquisition (YYYY-MM-DD)", example: '2026-05-01' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'acquisitionDate must be YYYY-MM-DD' })
  acquisitionDate!: string;

  @ApiPropertyOptional({
    description:
      'Date de mise en service (YYYY-MM-DD). Si omis, prend la valeur de acquisitionDate.',
    example: '2026-05-15',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'putInServiceDate must be YYYY-MM-DD' })
  putInServiceDate?: string;

  @ApiProperty({
    description: "Coût d'acquisition HT (ex: '1500000.00')",
    example: '1500000.00',
  })
  @IsString()
  @IsNotEmpty()
  @IsNumberString()
  acquisitionCost!: string;

  @ApiPropertyOptional({
    description: 'Valeur résiduelle attendue en fin de vie',
    example: '0.00',
    default: '0.00',
  })
  @IsOptional()
  @IsString()
  @IsNumberString()
  residualValue?: string;

  @ApiProperty({
    description: "Méthode d'amortissement (linear ou declining)",
    enum: DEPRECIATION_METHODS,
  })
  @IsIn(DEPRECIATION_METHODS as readonly string[])
  depreciationMethod!: DepreciationMethod;

  @ApiProperty({ description: "Durée d'amortissement en mois", example: 60 })
  @IsInt()
  @Min(1)
  durationMonths!: number;

  @ApiPropertyOptional({
    description: "Taux dégressif (ex: '0.3500'). Requis si depreciationMethod = declining.",
    example: '0.3500',
  })
  @IsOptional()
  @IsString()
  @IsNumberString()
  decliningRate?: string;

  @ApiProperty({
    description: "Code SYSCOHADA du compte d'immobilisation brute (21x/22x/23x/24x)",
    example: '2411',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,10}$/, { message: 'assetAccountCode must be a SYSCOHADA code (digits only)' })
  assetAccountCode!: string;

  @ApiProperty({
    description: "Code SYSCOHADA du compte d'amortissement cumulé (28x)",
    example: '2841',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,10}$/, {
    message: 'depreciationAccountCode must be a SYSCOHADA code (digits only)',
  })
  depreciationAccountCode!: string;

  @ApiProperty({
    description: 'Code SYSCOHADA du compte de dotation aux amortissements (681x)',
    example: '6811',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,10}$/, { message: 'expenseAccountCode must be a SYSCOHADA code (digits only)' })
  expenseAccountCode!: string;
}
