import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumberString, IsOptional, IsString, Matches } from 'class-validator';

export class DisposeAssetDto {
  @ApiProperty({
    description: 'Date de cession ou de mise au rebut (YYYY-MM-DD)',
    example: '2026-12-31',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'disposalDate must be YYYY-MM-DD' })
  disposalDate!: string;

  @ApiPropertyOptional({
    description: 'Valeur de cession (si vente). Null si mise au rebut.',
    example: '500000.00',
  })
  @IsOptional()
  @IsString()
  @IsNumberString()
  disposalValue?: string;
}
