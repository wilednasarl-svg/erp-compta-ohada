import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

/** Corps de la requête de synchronisation du réalisé depuis la comptabilité. */
export class SyncActualsDto {
  @ApiProperty({
    type: Number,
    description: 'Exercice budgétaire à (re)synchroniser depuis les écritures validées.',
    example: 2026,
  })
  @IsInt()
  @Min(2000)
  @Max(2100)
  fiscalYear!: number;
}
