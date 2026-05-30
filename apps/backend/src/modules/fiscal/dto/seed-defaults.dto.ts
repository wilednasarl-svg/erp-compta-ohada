import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class SeedDefaultsDto {
  @ApiProperty({ example: 2026, description: "Exercice — date d'effet posée au 1er janvier" })
  @IsInt()
  @Min(2000)
  @Max(2200)
  fiscalYear!: number;
}
