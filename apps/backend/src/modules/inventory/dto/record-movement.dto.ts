import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { MOVEMENT_TYPES, type MovementType } from '../types/inventory.types';

export class RecordMovementDto {
  @ApiProperty({ enum: MOVEMENT_TYPES })
  @IsIn(MOVEMENT_TYPES as readonly string[])
  type!: MovementType;

  @ApiProperty({ description: 'Date du mouvement (YYYY-MM-DD)', example: '2026-05-25' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'movementDate must be YYYY-MM-DD' })
  movementDate!: string;

  /**
   * - purchase / sale / production : qty > 0
   * - adjustment : peut être négatif (delta)
   * - inventory_count : qty physique constatée (≥ 0)
   */
  @ApiProperty({ description: 'Quantité (signée pour adjustment, positive sinon)', example: '100' })
  @IsString()
  @IsNumberString()
  qty!: string;

  @ApiPropertyOptional({
    description: "Prix unitaire d'entrée (requis si purchase ou adjustment positif).",
    example: '5000.00',
  })
  @IsOptional()
  @IsString()
  @IsNumberString()
  unitPrice?: string;

  @ApiPropertyOptional({ description: 'Référence document source', example: 'FACT-2026-042' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reference?: string;

  @ApiPropertyOptional({ description: 'Description libre' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
