import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { BUDGET_AXIS_TYPES, type BudgetAxisType } from '../../types/budget.types';

/** Réponse API pour un axe analytique. */
export class BudgetAxisResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ enum: BUDGET_AXIS_TYPES as readonly string[] })
  axisType!: BudgetAxisType;

  @ApiProperty({ example: 'COMM' })
  code!: string;

  @ApiProperty({ example: 'Direction commerciale' })
  label!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  parentId!: string | null;

  @ApiProperty({ type: Boolean })
  isActive!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class BudgetAxisEnvelopeResponse {
  @ApiProperty({ type: () => BudgetAxisResponse })
  axis!: BudgetAxisResponse;
}

export class ListBudgetAxesResponse {
  @ApiProperty({ type: () => [BudgetAxisResponse] })
  axes!: BudgetAxisResponse[];
}
