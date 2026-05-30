import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class GenerateSocialDto {
  @ApiProperty({ example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2200)
  periodYear!: number;

  @ApiProperty({ example: 3, description: 'Mois 1-12' })
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth!: number;
}
