import { IsArray, IsInt, Max, Min, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ComparisonQueryDto {
  @ApiProperty({
    description: 'Liste des années à comparer',
    type: [Number],
    example: [2022, 2023, 2024],
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(5)
  @IsInt({ each: true })
  @Min(2000, { each: true })
  @Max(2100, { each: true })
  @Type(() => Number)
  years!: number[];
}
