import { ApiProperty } from '@nestjs/swagger';

import {
  MOVEMENT_TYPES,
  STOCK_FAMILIES,
  STOCK_ITEM_STATUSES,
  VALUATION_METHODS,
  type MovementType,
  type StockFamily,
  type StockItemStatus,
  type ValuationMethod,
} from '../../types/inventory.types';

/**
 * Contrats Response du module inventory. Forme JSON strictement
 * préservée par rapport à la sérialisation TypeORM pré-DTO.
 */

export class InventoryItemResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;
  @ApiProperty()
  code!: string;
  @ApiProperty()
  label!: string;
  @ApiProperty()
  unitOfMeasure!: string;
  @ApiProperty({ enum: STOCK_FAMILIES })
  family!: StockFamily;
  @ApiProperty({ format: 'uuid' })
  stockAccountId!: string;
  @ApiProperty({ format: 'uuid' })
  purchaseAccountId!: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  saleAccountId!: string | null;
  @ApiProperty({ description: 'Qté en stock. NUMERIC(15,4) en string.' })
  currentQty!: string;
  @ApiProperty({ description: 'CMP courant. NUMERIC(15,4) en string.' })
  currentCmp!: string;
  @ApiProperty({ enum: STOCK_ITEM_STATUSES })
  status!: StockItemStatus;
  @ApiProperty({ enum: VALUATION_METHODS })
  valuationMethod!: ValuationMethod;
  @ApiProperty({ nullable: true, type: String })
  accountCode!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  createdById!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class InventoryMovementResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;
  @ApiProperty({ format: 'uuid' })
  itemId!: string;
  @ApiProperty({ enum: MOVEMENT_TYPES })
  type!: MovementType;
  @ApiProperty({ description: 'YYYY-MM-DD' })
  movementDate!: string;
  @ApiProperty({ description: 'NUMERIC(15,4) en string' })
  qty!: string;
  @ApiProperty({ nullable: true, type: String })
  unitPrice!: string | null;
  @ApiProperty({ description: 'Qté en stock après mvt. NUMERIC(15,4) en string.' })
  qtyAfter!: string;
  @ApiProperty({ description: 'CMP après mvt. NUMERIC(15,4) en string.' })
  cmpAfter!: string;
  @ApiProperty({ description: 'Valeur signée du mvt. DECIMAL(15,2) en string.' })
  movementValue!: string;
  @ApiProperty({ nullable: true, type: String })
  reference!: string | null;
  @ApiProperty({ nullable: true, type: String })
  description!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  journalEntryId!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  createdById!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

// ─── Enveloppes ──────────────────────────────────────────────────────

export class ListInventoryItemsResponse {
  @ApiProperty({ type: () => [InventoryItemResponse] })
  items!: InventoryItemResponse[];
}

export class InventoryItemEnvelopeResponse {
  @ApiProperty({ type: () => InventoryItemResponse })
  item!: InventoryItemResponse;
}

export class ListInventoryMovementsResponse {
  @ApiProperty({ type: () => [InventoryMovementResponse] })
  movements!: InventoryMovementResponse[];
}

export class RecordMovementResponse {
  @ApiProperty({ type: () => InventoryMovementResponse })
  movement!: InventoryMovementResponse;

  @ApiProperty({ type: () => InventoryItemResponse })
  item!: InventoryItemResponse;
}
