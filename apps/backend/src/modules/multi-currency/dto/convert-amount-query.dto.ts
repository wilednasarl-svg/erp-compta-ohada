import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumberString, IsOptional, IsString, Matches } from 'class-validator';

export class ConvertAmountQueryDto {
  @ApiProperty({ example: '100000.00' })
  @IsString()
  @IsNotEmpty()
  @IsNumberString()
  amount!: string;

  @ApiProperty({ example: 'EUR' })
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  fromCurrencyCode!: string;

  @ApiProperty({ example: 'XOF' })
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  toCurrencyCode!: string;

  @ApiPropertyOptional({
    description: "Date pour la résolution du taux (défaut: aujourd'hui)",
    example: '2026-05-25',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  asOfDate?: string;
}
