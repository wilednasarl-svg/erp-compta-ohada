import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * W4.6 — Payload de paiement (`settle`) ou de declaration d'impaye
 * (`markUnpaid`) d'un effet de commerce. La transition comptable depend
 * de l'etat courant de l'effet (cf. service).
 */
export class SettleBillDto {
  /** Date de paiement / d'impaye (ISO YYYY-MM-DD). */
  @ApiProperty({ example: '2026-05-01' })
  @Matches(DATE_PATTERN, { message: 'eventDate doit être au format YYYY-MM-DD' })
  readonly eventDate!: string;

  /** Code du journal cible (defaut BQ pour paiements, OD pour impaye). */
  @ApiPropertyOptional({ example: 'BQ' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  readonly journalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  readonly note?: string;
}
