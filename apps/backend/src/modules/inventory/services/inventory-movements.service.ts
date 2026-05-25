import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { InventoryItemEntity } from '../entities/inventory-item.entity';
import { InventoryMovementEntity } from '../entities/inventory-movement.entity';
import { InventoryItemRepository } from '../repositories/inventory-item.repository';
import {
  InventoryMovementRepository,
  type ListMovementsFilters,
} from '../repositories/inventory-movement.repository';
import type { MovementType } from '../types/inventory.types';
import {
  applyAdjustment,
  applyInventoryCount,
  applyPurchase,
  applySale,
  type ValuationResult,
} from './cmp-calculator';
import { InventoryItemsService } from './inventory-items.service';

export interface RecordMovementInput {
  readonly type: MovementType;
  readonly movementDate: string;
  readonly qty: string;
  readonly unitPrice?: string | null;
  readonly reference?: string | null;
  readonly description?: string | null;
}

export interface RecordMovementResult {
  readonly movement: InventoryMovementEntity;
  readonly item: InventoryItemEntity;
}

/**
 * `InventoryMovementsService` — enregistre un mouvement de stock dans
 * une transaction unique :
 *
 *   1. Lock l'item (SELECT ... FOR UPDATE) pour sérialiser les
 *      mouvements concurrents sur le même article.
 *   2. Applique la formule CMP via `CmpCalculator` (pur).
 *   3. INSERT du `inventory_movements` avec snapshot {qty_after, cmp_after}.
 *   4. UPDATE de `inventory_items.{currentQty, currentCmp}`.
 *
 * Tout est dans la même transaction → soit tout réussit, soit rien.
 *
 * La génération de l'écriture comptable correspondante (débit 31x /
 * crédit 401x pour purchase, etc.) est wave 2 (`journal_entry_id`
 * laissé NULL en wave 1).
 */
@Injectable()
export class InventoryMovementsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly itemsRepo: InventoryItemRepository,
    private readonly movementsRepo: InventoryMovementRepository,
    private readonly itemsService: InventoryItemsService,
  ) {}

  async recordMovement(
    organizationId: TenantId,
    itemId: string,
    input: RecordMovementInput,
    actorId: string,
  ): Promise<RecordMovementResult> {
    assertTenantId(organizationId);

    return this.dataSource.transaction(async (manager) => {
      // SELECT ... FOR UPDATE on the item — serializes concurrent
      // movements on the same SKU.
      const itemRepo = manager.getRepository(InventoryItemEntity);
      const item = await itemRepo
        .createQueryBuilder('i')
        .where('i.id = :id AND i.organization_id = :organizationId', {
          id: itemId,
          organizationId,
        })
        .setLock('pessimistic_write')
        .getOne();

      if (!item) {
        // Re-using the service's NotFoundException keeps the error shape consistent.
        return this.itemsService.findById(itemId, organizationId).then(() => {
          throw new Error('unreachable');
        });
      }
      if (item.status !== 'active') {
        throw new BadRequestException(
          `Cannot record movement on archived item '${item.code}'.`,
        );
      }

      const state = { qty: item.currentQty, cmp: item.currentCmp };
      const result = this.computeValuation(state, input);

      const movement = await this.movementsRepo.create(
        {
          organizationId,
          itemId: item.id,
          type: input.type,
          movementDate: input.movementDate,
          qty: String(input.qty),
          unitPrice: input.unitPrice ?? null,
          qtyAfter: result.qty,
          cmpAfter: result.cmp,
          movementValue: result.movementValue,
          reference: input.reference ?? null,
          description: input.description ?? null,
          createdById: actorId,
        },
        manager,
      );

      await this.itemsRepo.updateState(
        item.id,
        organizationId,
        { currentQty: result.qty, currentCmp: result.cmp },
        manager,
      );

      const refreshed = await itemRepo.findOneOrFail({
        where: { id: item.id, organizationId },
      });

      return { movement, item: refreshed };
    });
  }

  async list(
    organizationId: TenantId,
    filters: ListMovementsFilters = {},
  ): Promise<InventoryMovementEntity[]> {
    assertTenantId(organizationId);
    return this.movementsRepo.list(organizationId, filters);
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private computeValuation(
    state: { qty: string; cmp: string },
    input: RecordMovementInput,
  ): ValuationResult {
    switch (input.type) {
      case 'purchase':
      case 'production':
        if (input.unitPrice === undefined || input.unitPrice === null) {
          throw new BadRequestException(
            `${input.type} movement requires a unitPrice.`,
          );
        }
        return applyPurchase(state, { qty: input.qty, unitPrice: input.unitPrice });
      case 'sale':
        return applySale(state, { qty: input.qty });
      case 'adjustment':
        return applyAdjustment(state, {
          deltaQty: input.qty,
          unitPrice: input.unitPrice ?? undefined,
        });
      case 'inventory_count':
        return applyInventoryCount(state, { physicalQty: input.qty });
    }
  }
}
