import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/**
 * Plage en `YYYY-MM` pour le tableau de trésorerie nette glissante.
 * Maximum 60 mois (garde-fou côté service).
 */
export class CashTrendQueryDto {
  @ApiProperty({ example: '2025-01', description: 'Premier mois (inclusive)' })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'fromMonth must be YYYY-MM' })
  fromMonth!: string;

  @ApiProperty({ example: '2026-12', description: 'Dernier mois (inclusive)' })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'toMonth must be YYYY-MM' })
  toMonth!: string;
}
