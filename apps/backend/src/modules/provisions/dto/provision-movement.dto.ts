import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const AMOUNT_PATTERN = /^\d{1,15}(\.\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Payload commun aux mouvements de provision : dotation complémentaire,
 * reprise et utilisation. Le `kind` est porté par la route, pas par le corps.
 */
export class ProvisionMovementDto {
  @ApiProperty({ example: '1500000.00', description: 'Montant du mouvement (> 0, string décimal)' })
  @IsString()
  @Matches(AMOUNT_PATTERN, { message: 'amount doit être un montant positif (max 2 décimales)' })
  readonly amount!: string;

  @ApiProperty({ example: '2026-03-31', description: "Date d'effet comptable (YYYY-MM-DD)" })
  @Matches(DATE_PATTERN, { message: 'effectiveDate doit être au format YYYY-MM-DD' })
  readonly effectiveDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  readonly note?: string;
}
