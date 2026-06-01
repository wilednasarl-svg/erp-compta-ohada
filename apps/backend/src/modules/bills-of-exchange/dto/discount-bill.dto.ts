import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const AMOUNT_PATTERN = /^\d{1,15}(\.\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * W4.6 — Payload d'escompte d'un effet a recevoir.
 *
 * Ecriture posee : D 5121 net + D 6745 escompte + D 6312 frais / C 415
 * nominal. `netAmount = nominalAmount - discountFee - bankFee` doit
 * rester strictement positif (sinon BILL_NEGATIVE_NET).
 */
export class DiscountBillDto {
  /** Date d'escompte (ISO YYYY-MM-DD). */
  @ApiProperty({ example: '2026-03-15' })
  @Matches(DATE_PATTERN, { message: 'eventDate doit être au format YYYY-MM-DD' })
  readonly eventDate!: string;

  /** Escompte bancaire (agio) — charge financiere 6745. */
  @ApiProperty({ example: '45000.00' })
  @IsString()
  @Matches(AMOUNT_PATTERN, { message: 'discountFee doit être un montant positif (max 2 décimales)' })
  readonly discountFee!: string;

  /** Frais bancaires (services bancaires) — charge 6312. */
  @ApiProperty({ example: '5000.00' })
  @IsString()
  @Matches(AMOUNT_PATTERN, { message: 'bankFee doit être un montant positif (max 2 décimales)' })
  readonly bankFee!: string;

  /** Code du journal cible (defaut BQ si non fourni). */
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
