import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class ComputeDeclarationDto {
  @ApiProperty({ description: 'Année de la déclaration (ex: 2026)', example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2200)
  year!: number;

  @ApiProperty({ description: 'Mois de la déclaration (1 à 12)', example: 5 })
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}
