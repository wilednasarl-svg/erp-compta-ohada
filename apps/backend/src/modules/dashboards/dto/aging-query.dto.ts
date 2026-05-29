import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

import type { AgingType } from '../types/dashboard-types';

/**
 * Query params for `GET /organizations/:id/dashboards/aging`.
 *
 *   - `type`       : 'clients' → comptes 41x (créances).
 *                    'fournisseurs' → comptes 40x (dettes).
 *   - `exerciseId` : UUID d'exercice. Limite la fenêtre des écritures
 *                    considérées au range de l'exercice (sécurité +
 *                    cohérence avec les états du summary).
 *   - `asOfDate`   : date de référence pour calculer days_since.
 *                    Défaut : `endDate` de l'exercice. Format
 *                    YYYY-MM-DD.
 *   - `companyId`  : placeholder, ignoré en wave 1.
 */
export class AgingQueryDto {
  @ApiProperty({
    enum: ['clients', 'fournisseurs'],
    description: 'Type de partenaire à agréger',
  })
  @IsIn(['clients', 'fournisseurs'])
  type!: AgingType;

  @ApiProperty({
    description: "UUID de l'exercice (accounting_periods racine annuelle)",
    example: '00000000-0000-0000-0000-000000000000',
  })
  @IsUUID('4')
  exerciseId!: string;

  @ApiPropertyOptional({
    description:
      "Date de référence pour le calcul de days_since. Défaut = endDate de l'exercice. Format YYYY-MM-DD.",
    example: '2026-05-25',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'asOfDate must be a YYYY-MM-DD string',
  })
  asOfDate?: string;

  @ApiPropertyOptional({
    description: 'Filtre par dossier comptable (placeholder)',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  companyId?: string;
}
