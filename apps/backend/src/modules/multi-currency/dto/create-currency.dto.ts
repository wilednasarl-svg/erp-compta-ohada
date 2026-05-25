import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateCurrencyDto {
  @ApiProperty({ description: 'Code ISO 4217 (3 lettres maj)', example: 'KES' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{3}$/, { message: 'code must be 3 uppercase letters (ISO 4217)' })
  code!: string;

  @ApiProperty({ description: 'Libellé humain de la devise', example: 'Shilling kényan' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label!: string;

  @ApiPropertyOptional({
    description: "Nombre de décimales d'affichage (exposant ISO 4217)",
    example: 2,
    default: 2,
    enum: [0, 2, 3],
  })
  @IsOptional()
  @IsIn([0, 2, 3])
  decimalPlaces?: 0 | 2 | 3;

  @ApiPropertyOptional({ description: "Symbole d'affichage", example: 'KSh' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  symbol?: string;

  @ApiPropertyOptional({ description: 'Devise active à la création', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
