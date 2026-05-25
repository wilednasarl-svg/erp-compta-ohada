import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import type { TopAccountCategory } from '../types/dashboard-types';

/**
 * Query params for `GET /organizations/:id/dashboards/top-accounts`.
 *
 *   - `category` : 'expenses' = classe 6, tri net débit desc.
 *                  'revenue'  = classe 7, tri net crédit desc.
 *   - `limit`    : 1-50, défaut 10. Cappé à 50 pour ne pas peindre
 *                  un camembert avec 100 tranches illisibles.
 */
export class TopAccountsQueryDto {
  @ApiProperty({ description: "UUID de l'exercice (accounting_periods racine)" })
  @IsUUID('4')
  exerciseId!: string;

  @ApiProperty({ enum: ['expenses', 'revenue'] })
  @IsIn(['expenses', 'revenue'])
  category!: TopAccountCategory;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
