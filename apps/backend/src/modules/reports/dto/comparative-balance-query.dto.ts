import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/**
 * Query parameters for the comparative balance report (Module 9 wave 3).
 *
 * Juxtaposes the period [fromDate, toDate] (current, "N") with
 * [previousFromDate, previousToDate] (previous, "N-1") for every account
 * and exposes the natural-side balance cumulated up to `toDate` as
 * "SOLDE". Reproduces the typical Sage SYSCOHADA balance pluri-exercices
 * layout (cf. exports clients Gravel Ivoire).
 *
 * Both period bounds are required — without N-1 dates this would
 * collapse to the regular trial balance.
 */
export class ComparativeBalanceQueryDto {
  @ApiProperty({ example: '2026-01-01', description: "Début période N (inclusive)" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate!: string;

  @ApiProperty({ example: '2026-12-31', description: 'Fin période N (inclusive)' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'toDate must be YYYY-MM-DD' })
  toDate!: string;

  @ApiProperty({ example: '2025-01-01', description: 'Début période N-1 (inclusive)' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'previousFromDate must be YYYY-MM-DD',
  })
  previousFromDate!: string;

  @ApiProperty({ example: '2025-12-31', description: 'Fin période N-1 (inclusive)' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'previousToDate must be YYYY-MM-DD',
  })
  previousToDate!: string;

  @ApiProperty({ required: false, description: 'Filtrer sur une classe OHADA (1-9)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  accountClass?: number;

  @ApiProperty({ required: false, description: 'Borne inférieure inclusive sur le code compte' })
  @IsOptional()
  @IsString()
  accountCodeFrom?: string;

  @ApiProperty({ required: false, description: 'Borne supérieure inclusive sur le code compte' })
  @IsOptional()
  @IsString()
  accountCodeTo?: string;

  @ApiProperty({
    required: false,
    description: 'Masquer les comptes sans mouvement sur N et N-1 et sans solde',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  hideEmpty?: boolean;

  @ApiProperty({ required: false, description: "Type d'axe analytique (CHANTIER, BU, ...)" })
  @IsOptional()
  @IsString()
  analyticAxisType?: string;

  @ApiProperty({ required: false, description: "Code de l'axe analytique" })
  @IsOptional()
  @IsString()
  analyticAxisCode?: string;
}
