import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import type { TvaCodeKind, TvaCodeType } from '../types/tva.types';

const TVA_TYPES: ReadonlyArray<TvaCodeType> = ['sales', 'purchase', 'both'];
const TVA_KINDS: ReadonlyArray<TvaCodeKind> = [
  'normal',
  'reduced',
  'exempt',
  'exonerated',
  'export',
];

export class CreateTvaCodeDto {
  @ApiProperty({
    description: 'Identifiant code TVA (lettres maj, chiffres, tirets ; 1-16 chars)',
    example: 'TVA-N-18',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9-]{1,16}$/)
  code!: string;

  @ApiProperty({ description: 'Libellé descriptif', example: 'TVA Normale 18%' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  @ApiProperty({
    description: 'Taux TVA (0.00 → 99.99, format string pour préserver la précision)',
    example: '18.00',
  })
  @IsNumberString({ no_symbols: false })
  @Matches(/^\d{1,2}(\.\d{1,2})?$/, {
    message: 'rate doit être un nombre 0.00–99.99 avec au plus 2 décimales',
  })
  rate!: string;

  @ApiProperty({ description: 'Direction (vente / achat / les deux)', enum: TVA_TYPES })
  @IsIn(TVA_TYPES as readonly string[])
  type!: TvaCodeType;

  @ApiProperty({ description: 'Nature fiscale', enum: TVA_KINDS })
  @IsIn(TVA_KINDS as readonly string[])
  kind!: TvaCodeKind;

  @ApiPropertyOptional({ description: 'Actif par défaut', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
