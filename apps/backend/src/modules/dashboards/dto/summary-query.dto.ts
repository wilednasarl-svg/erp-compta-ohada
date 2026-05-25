import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Query params for `GET /organizations/:id/dashboards/summary`.
 *
 *   - `exerciseId`  : UUID d'un `accounting_periods` racine (annuel).
 *                     Les bornes startDate/endDate de cet exercice
 *                     définissent la fenêtre YTD du summary et le
 *                     "as-of" des soldes instantanés.
 *   - `companyId`   : placeholder pour le filtrage par dossier comptable
 *                     (Module 2 vague 2 — Company entity pas encore
 *                     matérialisée). Accepté en passthrough et ignoré
 *                     côté service tant que la colonne `company_id`
 *                     n'est pas indexée sur les écritures.
 */
export class SummaryQueryDto {
  @ApiProperty({
    description: "UUID de l'exercice (accounting_periods racine annuelle)",
    example: '00000000-0000-0000-0000-000000000000',
  })
  @IsUUID('4')
  exerciseId!: string;

  @ApiPropertyOptional({
    description: 'Filtre par dossier comptable (placeholder Module 2 wave 2)',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  companyId?: string;
}
