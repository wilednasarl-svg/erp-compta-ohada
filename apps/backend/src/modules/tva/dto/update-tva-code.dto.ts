import { ApiPropertyOptional } from '@nestjs/swagger';
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

/**
 * Patch partiel d'un code TVA. Le `code` est immuable — le renommer ferait
 * exploser les rattachements sémantiques côté écritures et déclarations
 * passées.
 */
export class UpdateTvaCodeDto {
  @ApiPropertyOptional({ description: 'Libellé descriptif' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional({ description: 'Taux TVA (0.00 → 99.99)' })
  @IsOptional()
  @IsNumberString({ no_symbols: false })
  @Matches(/^\d{1,2}(\.\d{1,2})?$/, {
    message: 'rate doit être un nombre 0.00–99.99 avec au plus 2 décimales',
  })
  rate?: string;

  @ApiPropertyOptional({ description: 'Direction', enum: TVA_TYPES })
  @IsOptional()
  @IsIn(TVA_TYPES as readonly string[])
  type?: TvaCodeType;

  @ApiPropertyOptional({ description: 'Nature fiscale', enum: TVA_KINDS })
  @IsOptional()
  @IsIn(TVA_KINDS as readonly string[])
  kind?: TvaCodeKind;

  @ApiPropertyOptional({ description: 'Actif / désactivé' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
