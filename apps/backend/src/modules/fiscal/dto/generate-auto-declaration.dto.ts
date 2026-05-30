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

/**
 * Génération avec base DÉRIVÉE de la comptabilité. `baseOverride` permet de
 * forcer une base explicite (ex. patente, ou correction manuelle).
 */
export class GenerateAutoDeclarationDto {
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

  @ApiPropertyOptional({ description: 'Force une base explicite (sinon dérivée de la compta)' })
  @IsOptional()
  @IsNumberString({ no_symbols: false })
  @Matches(/^-?\d{1,16}(\.\d{1,2})?$/)
  baseOverride?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
