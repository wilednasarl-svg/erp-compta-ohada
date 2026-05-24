import { IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Corps commun à POST /rules/:id/simulate et POST /rules/:id/apply. */
export class ExecuteRuleDto {
  @ApiPropertyOptional({
    description: 'Filtrer sur un code journal (ex. BQ, AC, VE).',
    example: 'BQ',
  })
  @IsOptional()
  @IsString()
  journal?: string;

  @ApiPropertyOptional({
    description: 'Date de début de période (ISO YYYY-MM-DD, incluse).',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Date de fin de période (ISO YYYY-MM-DD, incluse).',
    example: '2026-03-31',
  })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional({
    description: "Limiter à une session d'import spécifique.",
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  importSessionId?: string;
}
