import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { InventoryMovementEntity } from '../entities/inventory-movement.entity';
import type { MovementType } from '../types/inventory.types';

export interface CreateMovementInput {
  readonly organizationId: TenantId | string;
  readonly itemId: string;
  readonly type: MovementType;
  readonly movementDate: string;
  readonly qty: string;
  readonly unitPrice?: string | null;
  readonly qtyAfter: string;
  readonly cmpAfter: string;
  readonly movementValue: string;
  readonly reference?: string | null;
  readonly description?: string | null;
  readonly journalEntryId?: string | null;
  readonly createdById?: string | null;
}

export interface ListMovementsFilters {
  readonly itemId?: string;
  readonly type?: MovementType;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly limit?: number;
}

@Injectable()
export class InventoryMovementRepository {
  constructor(
    @InjectRepository(InventoryMovementEntity)
    private readonly repo: Repository<InventoryMovementEntity>,
  ) {}

  async create(
    input: CreateMovementInput,
    manager: EntityManager,
  ): Promise<InventoryMovementEntity> {
    assertTenantId(input.organizationId);
    const repo = manager.getRepository(InventoryMovementEntity);
    const entity = repo.create({
      organizationId: input.organizationId,
      itemId: input.itemId,
      type: input.type,
      movementDate: input.movementDate,
      qty: input.qty,
      unitPrice: input.unitPrice ?? null,
      qtyAfter: input.qtyAfter,
      cmpAfter: input.cmpAfter,
      movementValue: input.movementValue,
      reference: input.reference ?? null,
      description: input.description ?? null,
      journalEntryId: input.journalEntryId ?? null,
      createdById: input.createdById ?? null,
    });
    return repo.save(entity);
  }

  async list(
    organizationId: TenantId | string,
    filters: ListMovementsFilters = {},
  ): Promise<InventoryMovementEntity[]> {
    assertTenantId(organizationId);
    const qb = this.repo
      .createQueryBuilder('m')
      .where('m.organization_id = :organizationId', { organizationId })
      .orderBy('m.movement_date', 'DESC')
      .addOrderBy('m.created_at', 'DESC');

    if (filters.itemId) qb.andWhere('m.item_id = :itemId', { itemId: filters.itemId });
    if (filters.type) qb.andWhere('m.type = :type', { type: filters.type });
    if (filters.fromDate) {
      qb.andWhere('m.movement_date >= :fromDate::date', { fromDate: filters.fromDate });
    }
    if (filters.toDate) {
      qb.andWhere('m.movement_date <= :toDate::date', { toDate: filters.toDate });
    }
    qb.limit(filters.limit && filters.limit > 0 ? Math.min(filters.limit, 500) : 100);
    return qb.getMany();
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<InventoryMovementEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }
}
