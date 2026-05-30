import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { BUDGET_AXIS_TYPES, type BudgetAxisType } from '../types/budget.types';

export class CreateBudgetAxisDto {
  @ApiProperty({
    description: "Type d'axe analytique",
    enum: BUDGET_AXIS_TYPES as readonly string[],
  })
  @IsIn(BUDGET_AXIS_TYPES as readonly string[])
  axisType!: BudgetAxisType;

  @ApiProperty({ description: "Code de l'axe (maj, chiffres, tirets ; 1-32)", example: 'COMM' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9-]{1,32}$/)
  code!: string;

  @ApiProperty({ description: 'Libellé', example: 'Direction commerciale' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  @ApiPropertyOptional({ description: 'Axe parent (consolidation hiérarchique)' })
  @IsOptional()
  @IsUUID('4')
  parentId?: string;

  @ApiPropertyOptional({ description: 'Actif par défaut', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
