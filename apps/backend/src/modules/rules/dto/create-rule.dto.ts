import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { RuleAction, RuleCondition } from '../types/rule.types';

export class CreateRuleDto {
  @ApiProperty({ example: 'Reclassement charges bancaires admin' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Si compte 62x et journal BQ → centre coûts ADMIN' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    default: 100,
    description: "Ordre d'évaluation — valeur basse = évaluée en premier.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiProperty({
    description: 'Liste des conditions (toutes doivent être satisfaites — AND logique).',
    example: [
      { type: 'account_prefix', prefix: '62' },
      { type: 'journal_in', journals: ['BQ'] },
    ],
  })
  @IsArray()
  conditions!: RuleCondition[];

  @ApiProperty({
    description: 'Liste des actions à appliquer quand toutes les conditions sont satisfaites.',
    example: [{ type: 'assign_cost_center', costCenter: 'ADMIN' }],
  })
  @IsArray()
  @MinLength(1, { each: false, message: 'Au moins une action est requise.' })
  actions!: RuleAction[];
}
