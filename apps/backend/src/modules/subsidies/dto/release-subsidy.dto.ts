import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const AMOUNT_PATTERN = /^\d{1,15}(\.\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * W4.4 — Payload d'une reprise manuelle de subvention au résultat.
 *
 * Réservé à `releaseMethod === 'manual'` : le caller choisit librement
 * le montant et la date.
 */
export class ReleaseSubsidyDto {
  /** Montant à reprendre (NUMERIC 15,2 — chaîne "0.00", > 0). */
  @ApiProperty({ example: '1500000.00' })
  @IsString()
  @Matches(AMOUNT_PATTERN, { message: 'amount doit être un montant positif (max 2 décimales)' })
  readonly amount!: string;

  /** Date de reprise (ISO YYYY-MM-DD). */
  @ApiProperty({ example: '2026-03-31' })
  @Matches(DATE_PATTERN, { message: 'releaseDate doit être au format YYYY-MM-DD' })
  readonly releaseDate!: string;

  /** Code du journal cible (défaut OD si non fourni). */
  @ApiPropertyOptional({ example: 'OD' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  readonly journalCode?: string;

  /** Note libre attachée à l'écriture de reprise. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  readonly note?: string;
}
