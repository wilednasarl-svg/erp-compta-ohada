import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { InventoryItemEntity } from '../entities/inventory-item.entity';
import type { StockFamily, StockItemStatus } from '../types/inventory.types';

export interface CreateInventoryItemInput {
  readonly organizationId: TenantId | string;
  readonly code: string;
  readonly label: string;
  readonly unitOfMeasure?: string;
  readonly family: StockFamily;
  readonly stockAccountId: string;
  readonly purchaseAccountId: string;
  readonly saleAccountId?: string | null;
  readonly status?: StockItemStatus;
  readonly createdById?: string | null;
}

export interface UpdateInventoryItemInput {
  readonly label?: string;
  readonly unitOfMeasure?: string;
  readonly stockAccountId?: string;
  readonly purchaseAccountId?: string;
  readonly saleAccountId?: string | null;
  readonly status?: StockItemStatus;
}

export interface InventoryStateUpdate {
  readonly currentQty: string;
  readonly currentCmp: string;
}

@Injectable()
export class InventoryItemRepository {
  constructor(
    @InjectRepository(InventoryItemEntity)
    private readonly repo: Repository<InventoryItemEntity>,
  ) {}

  async create(
    input: CreateInventoryItemInput,
    manager?: EntityManager,
  ): Promise<InventoryItemEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(InventoryItemEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      code: input.code.toUpperCase(),
      label: input.label,
      unitOfMeasure: input.unitOfMeasure ?? 'unit',
      family: input.family,
      stockAccountId: input.stockAccountId,
      purchaseAccountId: input.purchaseAccountId,
      saleAccountId: input.saleAccountId ?? null,
      status: input.status ?? 'active',
      currentQty: '0.0000',
      currentCmp: '0.0000',
      createdById: input.createdById ?? null,
    });
    return repo.save(entity);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<InventoryItemEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findByCode(
    organizationId: TenantId | string,
    code: string,
  ): Promise<InventoryItemEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: { organizationId, code: code.toUpperCase() },
    });
  }

  async listByOrganization(
    organizationId: TenantId | string,
    options: { activeOnly?: boolean; family?: StockFamily } = {},
  ): Promise<InventoryItemEntity[]> {
    assertTenantId(organizationId);
    const where: Record<string, unknown> = { organizationId };
    if (options.activeOnly === true) where['status'] = 'active';
    if (options.family) where['family'] = options.family;
    return this.repo.find({ where, order: { code: 'ASC' } });
  }

  async update(
    id: string,
    organizationId: TenantId | string,
    patch: UpdateInventoryItemInput,
    manager?: EntityManager,
  ): Promise<InventoryItemEntity> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(InventoryItemEntity) : this.repo;
    await repo.update({ id, organizationId }, patch);
    const updated = await repo.findOne({ where: { id, organizationId } });
    if (!updated) {
      throw new Error(`InventoryItem ${id} disappeared after UPDATE in org ${organizationId}`);
    }
    return updated;
  }

  /**
   * Met à jour qty + CMP après l'application d'un mouvement. Appelé
   * EXCLUSIVEMENT par `InventoryMovementsService.recordMovement` dans
   * la transaction qui insère le `inventory_movements` correspondant —
   * jamais en standalone.
   */
  async updateState(
    id: string,
    organizationId: TenantId | string,
    state: InventoryStateUpdate,
    manager: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    const repo = manager.getRepository(InventoryItemEntity);
    await repo.update(
      { id, organizationId },
      {
        currentQty: state.currentQty,
        currentCmp: state.currentCmp,
      },
    );
  }
}
