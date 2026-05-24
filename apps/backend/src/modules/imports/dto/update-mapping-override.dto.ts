import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

export class UpdateMappingOverrideDto {
  @ApiProperty({
    description: 'A record mapping the source header names to the target model fields',
    example: { 'Date fact.': 'date', 'Description': 'label' },
  })
  @IsObject()
  @IsOptional()
  mappingOverride?: Record<string, string>;
}
