import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  BUDGET_LINE_STATUSES,
  BUDGET_SCENARIOS,
  BUDGET_TYPES,
  type BudgetLineStatus,
  type BudgetScenario,
  type BudgetType,
} from '../../types/budget.types';

/** Réponse API pour une ligne budgétaire. Montants en string NUMERIC. */
export class BudgetLineResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 2026 })
  fiscalYear!: number;

  @ApiPropertyOptional({ nullable: true, example: 3 })
  periodMonth!: number | null;

  @ApiProperty({ enum: BUDGET_TYPES as readonly string[] })
  budgetType!: BudgetType;

  @ApiProperty({ enum: BUDGET_SCENARIOS as readonly string[] })
  scenario!: BudgetScenario;

  @ApiProperty({ example: '6221' })
  accountCode!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Locations immobilières' })
  accountLabel!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  costCenterAxisId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  projectAxisId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  agencyAxisId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  productAxisId!: string | null;

  @ApiProperty({ type: String, example: '1500000.00' })
  amount!: string;

  @ApiProperty({ example: 'XOF' })
  currency!: string;

  @ApiProperty({ type: String, example: '1.000000' })
  exchangeRate!: string;

  @ApiProperty({
    type: String,
    example: '1500000.00',
    description: 'Montant en devise de base (XOF)',
  })
  amountBase!: string;

  @ApiPropertyOptional({ nullable: true })
  comment!: string | null;

  @ApiPropertyOptional({ nullable: true })
  hypothesis!: string | null;

  @ApiProperty({ enum: BUDGET_LINE_STATUSES as readonly string[] })
  status!: BudgetLineStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class BudgetLineEnvelopeResponse {
  @ApiProperty({ type: () => BudgetLineResponse })
  line!: BudgetLineResponse;
}

export class ListBudgetLinesResponse {
  @ApiProperty({ type: () => [BudgetLineResponse] })
  lines!: BudgetLineResponse[];

  @ApiProperty({ example: 100, description: 'Nombre total de lignes (avant pagination)' })
  total!: number;
}
