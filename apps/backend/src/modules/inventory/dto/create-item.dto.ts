import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { STOCK_FAMILIES, type StockFamily } from '../types/inventory.types';

export class CreateInventoryItemDto {
  @ApiProperty({
    description: 'SKU interne (lettres maj, chiffres, tirets ; 1-32 chars)',
    example: 'SKU-001',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9-]{1,32}$/, {
    message: 'code must be uppercase letters, digits and hyphens, 1-32 chars',
  })
  code!: string;

  @ApiProperty({ description: 'Désignation produit', example: 'Sac de ciment 50kg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  @ApiPropertyOptional({ description: 'Unité de mesure', example: 'kg', default: 'unit' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  unitOfMeasure?: string;

  @ApiProperty({ description: 'Famille SYSCOHADA', enum: STOCK_FAMILIES })
  @IsIn(STOCK_FAMILIES as readonly string[])
  family!: StockFamily;

  @ApiProperty({ description: 'ID compte de stock SYSCOHADA (31x-37x)' })
  @IsUUID()
  stockAccountId!: string;

  @ApiProperty({ description: "ID compte d'achat (60x)" })
  @IsUUID()
  purchaseAccountId!: string;

  @ApiPropertyOptional({
    description: 'ID compte de vente (70x). NULL si non revendu (stock interne).',
  })
  @IsOptional()
  @IsUUID()
  saleAccountId?: string;
}
