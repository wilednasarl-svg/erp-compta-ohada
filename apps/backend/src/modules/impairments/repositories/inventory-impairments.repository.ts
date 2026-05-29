import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { InventoryImpairmentEntity } from '../entities/inventory-impairment.entity';
import type { ImpairmentType } from '../types/impairment.types';

export interface CreateInventoryImpairmentInput {
  readonly organizationId: TenantId | string;
  readonly inventoryItemId: string;
  readonly testDate: string;
  readonly carryingAmount: string;
  readonly nrv: string;
  readonly impairmentAmount: string;
  readonly type: ImpairmentType;
  readonly journalEntryId?: string | null;
  readonly note?: string | null;
  readonly createdById?: string | null;
}

export interface UpdateInventoryImpairmentInput {
  readonly journalEntryId?: string | null;
}

@Injectable()
export class InventoryImpairmentsRepository {
  constructor(
    @InjectRepository(InventoryImpairmentEntity)
    private readonly repo: Repository<InventoryImpairmentEntity>,
  ) {}

  async create(
    input: CreateInventoryImpairmentInput,
    manager?: EntityManager,
  ): Promise<InventoryImpairmentEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(InventoryImpairmentEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      inventoryItemId: input.inventoryItemId,
      testDate: input.testDate,
      carryingAmount: input.carryingAmount,
      nrv: input.nrv,
      impairmentAmount: input.impairmentAmount,
      type: input.type,
      journalEntryId: input.journalEntryId ?? null,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    });
    return repo.save(entity);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<InventoryImpairmentEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async listByOrganization(
    organizationId: TenantId | string,
    inventoryItemId?: string,
    limit = 100,
  ): Promise<InventoryImpairmentEntity[]> {
    assertTenantId(organizationId);
    const where = inventoryItemId ? { organizationId, inventoryItemId } : { organizationId };
    return this.repo.find({
      where,
      order: { testDate: 'DESC', createdAt: 'DESC' },
      take: limit,
    });
  }

  async sumNetImpairmentsForItem(
    inventoryItemId: string,
    organizationId: TenantId | string,
  ): Promise<number> {
    assertTenantId(organizationId);
    const rows = await this.repo.find({
      where: { organizationId, inventoryItemId },
      select: ['impairmentAmount', 'type'],
    });
    return rows.reduce((acc, r) => {
      const amount = Number(r.impairmentAmount);
      return r.type === 'depreciation' ? acc + amount : acc - amount;
    }, 0);
  }

  async update(
    id: string,
    organizationId: TenantId | string,
    patch: UpdateInventoryImpairmentInput,
    manager?: EntityManager,
  ): Promise<InventoryImpairmentEntity> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(InventoryImpairmentEntity) : this.repo;
    await repo.update({ id, organizationId }, patch);
    const updated = await repo.findOne({ where: { id, organizationId } });
    if (!updated) {
      throw new Error(
        `InventoryImpairment ${id} disappeared after UPDATE in org ${organizationId}`,
      );
    }
    return updated;
  }
}
