import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class GenerateDeclarationDto {
  @ApiProperty({ example: 'TVA' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9_]{1,32}$/)
  taxCode!: string;

  @ApiProperty({ example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2200)
  periodYear!: number;

  @ApiPropertyOptional({ example: 3, description: 'Mois 1-12 ; omis pour annuel' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth?: number;

  @ApiPropertyOptional({ example: '45000000.00', description: 'Base imposable (défaut 0)' })
  @IsOptional()
  @IsNumberString({ no_symbols: false })
  @Matches(/^-?\d{1,16}(\.\d{1,2})?$/)
  baseAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
