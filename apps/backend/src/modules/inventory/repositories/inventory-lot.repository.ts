import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { InventoryLotEntity } from '../entities/inventory-lot.entity';

export interface CreateInventoryLotInput {
  readonly organizationId: TenantId | string;
  readonly inventoryItemId: string;
  readonly entryDate: string;
  readonly initialQty: string;
  readonly unitCost: string;
  readonly sourceMovementId?: string | null;
}

/**
 * `InventoryLotsRepository` — accès queue FIFO.
 *
 * `findByItem` retourne TOUS les lots dans l'ordre FIFO (entry_date ASC,
 * created_at ASC). `listAvailable` filtre sur `remainingQty > 0` — utilisé
 * lors d'une vente FIFO pour ne pas itérer sur des lots vides.
 *
 * `updateRemainingQty` est appelé en transaction par
 * `InventoryMovementsService` après consommation par le FifoCalculator.
 */
@Injectable()
export class InventoryLotsRepository {
  constructor(
    @InjectRepository(InventoryLotEntity)
    private readonly repo: Repository<InventoryLotEntity>,
  ) {}

  async create(
    input: CreateInventoryLotInput,
    manager: EntityManager,
  ): Promise<InventoryLotEntity> {
    assertTenantId(input.organizationId);
    const repo = manager.getRepository(InventoryLotEntity);
    const entity = repo.create({
      organizationId: input.organizationId,
      inventoryItemId: input.inventoryItemId,
      entryDate: input.entryDate,
      initialQty: input.initialQty,
      remainingQty: input.initialQty,
      unitCost: input.unitCost,
      sourceMovementId: input.sourceMovementId ?? null,
    });
    return repo.save(entity);
  }

  async findByItem(
    organizationId: TenantId | string,
    itemId: string,
    manager?: EntityManager,
  ): Promise<InventoryLotEntity[]> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(InventoryLotEntity) : this.repo;
    return repo
      .createQueryBuilder('l')
      .where('l.organization_id = :organizationId AND l.inventory_item_id = :itemId', {
        organizationId,
        itemId,
      })
      .orderBy('l.entry_date', 'ASC')
      .addOrderBy('l.created_at', 'ASC')
      .getMany();
  }

  async listAvailable(
    organizationId: TenantId | string,
    itemId: string,
    manager: EntityManager,
  ): Promise<InventoryLotEntity[]> {
    assertTenantId(organizationId);
    const repo = manager.getRepository(InventoryLotEntity);
    return repo
      .createQueryBuilder('l')
      .where('l.organization_id = :organizationId AND l.inventory_item_id = :itemId', {
        organizationId,
        itemId,
      })
      .andWhere('l.remaining_qty > 0')
      .orderBy('l.entry_date', 'ASC')
      .addOrderBy('l.created_at', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
  }

  async updateRemainingQty(
    lotId: string,
    newRemainingQty: string,
    manager: EntityManager,
  ): Promise<void> {
    const repo = manager.getRepository(InventoryLotEntity);
    await repo.update({ id: lotId }, { remainingQty: newRemainingQty });
  }
}
