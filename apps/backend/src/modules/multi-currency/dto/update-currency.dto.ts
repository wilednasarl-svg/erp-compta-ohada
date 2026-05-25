import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCurrencyDto {
  @ApiPropertyOptional({ example: 'Shilling kényan (renommé)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label?: string;

  @ApiPropertyOptional({ example: 'KSh' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  symbol?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
