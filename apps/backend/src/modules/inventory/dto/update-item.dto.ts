import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { STOCK_ITEM_STATUSES, type StockItemStatus } from '../types/inventory.types';

export class UpdateInventoryItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  unitOfMeasure?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  stockAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  purchaseAccountId?: string;

  @ApiPropertyOptional({ description: 'NULL accepted to clear the sale account.' })
  @IsOptional()
  @IsUUID()
  saleAccountId?: string;

  @ApiPropertyOptional({ enum: STOCK_ITEM_STATUSES })
  @IsOptional()
  @IsIn(STOCK_ITEM_STATUSES as readonly string[])
  status?: StockItemStatus;
}
