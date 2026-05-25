import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { ANOMALY_TYPES, type AnomalyType } from '../types/ai.types';

export class ListAnomaliesQueryDto {
  @ApiPropertyOptional({ description: 'Filtre par période comptable' })
  @IsOptional()
  @IsUUID()
  periodId?: string;

  @ApiPropertyOptional({ description: 'Filtre par écriture' })
  @IsOptional()
  @IsUUID()
  entryId?: string;

  @ApiPropertyOptional({ description: 'Filtre par compte du plan comptable' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ description: "Filtre par type d'anomalie", enum: ANOMALY_TYPES })
  @IsOptional()
  @IsIn(ANOMALY_TYPES as readonly string[])
  anomalyType?: AnomalyType;

  @ApiPropertyOptional({ description: 'Score minimum (0-100, inclus)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @ApiPropertyOptional({ description: 'Page (1-indexed)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Taille de page (1-200)', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
