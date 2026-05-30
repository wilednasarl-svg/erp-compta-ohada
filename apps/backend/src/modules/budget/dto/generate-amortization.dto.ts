import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import { BUDGET_SCENARIOS, type BudgetScenario } from '../types/budget.types';

export class GenerateAmortizationDto {
  @ApiProperty({ format: 'uuid', description: 'Ligne budgétaire CAPEX (investissement)' })
  @Matches(/^[0-9a-fA-F-]{36}$/)
  capexLineId!: string;

  @ApiProperty({ example: '2026-04-01', description: 'Date de mise en service (AAAA-MM-JJ)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  serviceDate!: string;

  @ApiProperty({ example: 3, description: "Durée d'amortissement (années)" })
  @IsInt()
  @Min(1)
  @Max(50)
  durationYears!: number;

  @ApiPropertyOptional({ example: '6811', description: 'Compte de dotation (défaut 6811)' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{1,12}$/)
  dotationAccount?: string;

  @ApiPropertyOptional({ enum: BUDGET_SCENARIOS as readonly string[] })
  @IsOptional()
  @IsIn(BUDGET_SCENARIOS as readonly string[])
  scenario?: BudgetScenario;
}
