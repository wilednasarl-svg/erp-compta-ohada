import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  BUDGET_SCENARIOS,
  BUDGET_TYPES,
  type BudgetScenario,
  type BudgetType,
} from '../types/budget.types';

export class CreateBudgetLineDto {
  @ApiProperty({ description: 'Exercice', example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2200)
  fiscalYear!: number;

  @ApiPropertyOptional({ description: 'Mois 1-12 ; omis = ligne annuelle', example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth?: number;

  @ApiProperty({ description: 'Famille de budget', enum: BUDGET_TYPES as readonly string[] })
  @IsIn(BUDGET_TYPES as readonly string[])
  budgetType!: BudgetType;

  @ApiPropertyOptional({
    description: 'Scénario',
    enum: BUDGET_SCENARIOS as readonly string[],
    default: 'BI',
  })
  @IsOptional()
  @IsIn(BUDGET_SCENARIOS as readonly string[])
  scenario?: BudgetScenario;

  @ApiProperty({ description: 'Compte SYSCOHADA', example: '6221' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{1,12}$/, {
    message: 'accountCode doit être un code comptable numérique (1-12 chiffres)',
  })
  accountCode!: string;

  @ApiPropertyOptional({ description: 'Libellé du compte', example: 'Locations immobilières' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountLabel?: string;

  @ApiPropertyOptional({ description: 'Axe centre de coût' })
  @IsOptional()
  @IsUUID('4')
  costCenterAxisId?: string;

  @ApiPropertyOptional({ description: 'Axe projet' })
  @IsOptional()
  @IsUUID('4')
  projectAxisId?: string;

  @ApiPropertyOptional({ description: 'Axe agence' })
  @IsOptional()
  @IsUUID('4')
  agencyAxisId?: string;

  @ApiPropertyOptional({ description: 'Axe produit' })
  @IsOptional()
  @IsUUID('4')
  productAxisId?: string;

  @ApiProperty({ description: 'Montant budgété (string NUMERIC)', example: '1500000.00' })
  @IsNumberString({ no_symbols: false })
  @Matches(/^-?\d{1,16}(\.\d{1,2})?$/, {
    message: 'amount doit être un nombre avec au plus 2 décimales',
  })
  amount!: string;

  @ApiPropertyOptional({ description: 'Devise ISO 4217', example: 'XOF', default: 'XOF' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({ description: 'Taux de change vers XOF', example: '1', default: '1' })
  @IsOptional()
  @IsNumberString({ no_symbols: false })
  @Matches(/^\d{1,6}(\.\d{1,6})?$/)
  exchangeRate?: string;

  @ApiPropertyOptional({ description: 'Commentaire' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @ApiPropertyOptional({ description: 'Hypothèse de construction' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hypothesis?: string;
}
