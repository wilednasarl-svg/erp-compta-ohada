import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class MarginByAxisQueryDto {
  @ApiProperty({ example: '2026-01-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromDate!: string;

  @ApiProperty({ example: '2026-12-31' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toDate!: string;

  @ApiProperty({
    example: 'CHANTIER',
    description: "Type d'axe analytique à grouper (CHANTIER, BU, ACTIVITE, PROJET).",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  axisType!: string;
}
