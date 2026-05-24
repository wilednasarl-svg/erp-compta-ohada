import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListEntriesQueryDto {
  @ApiPropertyOptional({ enum: ['draft', 'validated', 'cancelled'] })
  @IsOptional()
  @IsEnum(['draft', 'validated', 'cancelled'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  journalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  periodId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  pageSize?: number;
}
