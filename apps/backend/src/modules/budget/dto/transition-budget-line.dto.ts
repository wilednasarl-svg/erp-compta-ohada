import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import { BUDGET_LINE_STATUSES, type BudgetLineStatus } from '../types/budget.types';

/** Transition de statut dans le workflow de validation budgétaire. */
export class TransitionBudgetLineDto {
  @ApiProperty({
    description: 'Statut cible',
    enum: BUDGET_LINE_STATUSES as readonly string[],
    example: 'soumis',
  })
  @IsIn(BUDGET_LINE_STATUSES as readonly string[])
  targetStatus!: BudgetLineStatus;
}
