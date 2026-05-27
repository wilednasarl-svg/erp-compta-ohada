import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsInt, IsUUID, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class ConsolidatedQueryDto {
  @ApiProperty({ type: [String], description: 'List of organization UUIDs to aggregate' })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsUUID('4', { each: true })
  organizationIds!: string[];

  @ApiProperty({ example: 2024, description: 'The target year to consolidate' })
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  year!: number;
}
