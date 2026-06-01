import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, Matches } from 'class-validator';

/** Reprise indexée sur une dotation d'amortissement postée. */
export class ReleaseOnDepreciationDto {
  @ApiProperty({ description: "Id de la ligne d'échéancier d'amortissement déclencheuse" })
  @IsUUID()
  readonly depreciationScheduleId!: string;
}

/** Reprise linéaire mensuelle (méthode linear_10y). */
export class ReleaseLinearMonthlyDto {
  @ApiProperty({ example: '2026-03', description: 'Mois de reprise (YYYY-MM)' })
  @Matches(/^\d{4}-\d{2}$/, { message: 'month doit être au format YYYY-MM' })
  readonly month!: string;
}
