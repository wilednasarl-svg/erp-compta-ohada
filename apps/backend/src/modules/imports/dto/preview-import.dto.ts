import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query params de `POST /organizations/:id/imports/:sessionId/preview`.
 *
 * `limit` borné à 500 pour la même raison que les pagination des
 * autres modules : éviter qu'une UI naïve aspire le fichier complet
 * en une requête.
 */
export class PreviewImportDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  /**
   * Ne renvoyer que les lignes EN ERREUR dans la fenêtre `limit`/`offset`.
   * Indispensable quand les erreurs sont au-delà de la première page :
   * « 21 lignes en erreur » mais la page 1 toute verte.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  errorsOnly?: boolean;
}
