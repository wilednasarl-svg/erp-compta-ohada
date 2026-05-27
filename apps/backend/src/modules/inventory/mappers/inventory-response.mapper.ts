import type { InventoryItemEntity } from '../entities/inventory-item.entity';
import type { InventoryMovementEntity } from '../entities/inventory-movement.entity';
import type { RecordMovementResult } from '../services/inventory-movements.service';
import {
  InventoryItemEnvelopeResponse,
  InventoryItemResponse,
  InventoryMovementResponse,
  ListInventoryItemsResponse,
  ListInventoryMovementsResponse,
  RecordMovementResponse,
} from '../dto/responses';

export function toInventoryItemResponse(entity: InventoryItemEntity): InventoryItemResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    code: entity.code,
    label: entity.label,
    unitOfMeasure: entity.unitOfMeasure,
    family: entity.family,
    stockAccountId: entity.stockAccountId,
    purchaseAccountId: entity.purchaseAccountId,
    saleAccountId: entity.saleAccountId,
    currentQty: entity.currentQty,
    currentCmp: entity.currentCmp,
    status: entity.status,
    valuationMethod: entity.valuationMethod,
    accountCode: entity.accountCode,
    createdById: entity.createdById,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toInventoryMovementResponse(
  entity: InventoryMovementEntity,
): InventoryMovementResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    itemId: entity.itemId,
    type: entity.type,
    movementDate: entity.movementDate,
    qty: entity.qty,
    unitPrice: entity.unitPrice,
    qtyAfter: entity.qtyAfter,
    cmpAfter: entity.cmpAfter,
    movementValue: entity.movementValue,
    reference: entity.reference,
    description: entity.description,
    journalEntryId: entity.journalEntryId,
    createdById: entity.createdById,
    createdAt: entity.createdAt,
  };
}

export function toListInventoryItems(
  entities: ReadonlyArray<InventoryItemEntity>,
): ListInventoryItemsResponse {
  return { items: entities.map(toInventoryItemResponse) };
}

export function toInventoryItemEnvelope(
  entity: InventoryItemEntity,
): InventoryItemEnvelopeResponse {
  return { item: toInventoryItemResponse(entity) };
}

export function toListInventoryMovements(
  entities: ReadonlyArray<InventoryMovementEntity>,
): ListInventoryMovementsResponse {
  return { movements: entities.map(toInventoryMovementResponse) };
}

export function toRecordMovement(result: RecordMovementResult): RecordMovementResponse {
  return {
    movement: toInventoryMovementResponse(result.movement),
    item: toInventoryItemResponse(result.item),
  };
}
