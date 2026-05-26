import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AssetImpairmentEntity } from '../entities/asset-impairment.entity';
import type { ImpairmentType } from '../types/impairment.types';

export interface CreateAssetImpairmentInput {
  readonly organizationId: TenantId | string;
  readonly assetId: string;
  readonly testDate: string;
  readonly carryingAmount: string;
  readonly recoverableAmount: string;
  readonly impairmentAmount: string;
  readonly type: ImpairmentType;
  readonly journalEntryId?: string | null;
  readonly note?: string | null;
  readonly createdById?: string | null;
}

export interface UpdateAssetImpairmentInput {
  readonly journalEntryId?: string | null;
}

@Injectable()
export class AssetImpairmentsRepository {
  constructor(
    @InjectRepository(AssetImpairmentEntity)
    private readonly repo: Repository<AssetImpairmentEntity>,
  ) {}

  async create(
    input: CreateAssetImpairmentInput,
    manager?: EntityManager,
  ): Promise<AssetImpairmentEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(AssetImpairmentEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      assetId: input.assetId,
      testDate: input.testDate,
      carryingAmount: input.carryingAmount,
      recoverableAmount: input.recoverableAmount,
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
  ): Promise<AssetImpairmentEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async listByOrganization(
    organizationId: TenantId | string,
    assetId?: string,
    limit = 100,
  ): Promise<AssetImpairmentEntity[]> {
    assertTenantId(organizationId);
    const where = assetId ? { organizationId, assetId } : { organizationId };
    return this.repo.find({
      where,
      order: { testDate: 'DESC', createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Somme algébrique des dépréciations passées (depreciation − reprise)
   * pour un asset donné. Utile pour plafonner une reprise (App. 44).
   */
  async sumNetImpairmentsForAsset(
    assetId: string,
    organizationId: TenantId | string,
  ): Promise<number> {
    assertTenantId(organizationId);
    const rows = await this.repo.find({
      where: { organizationId, assetId },
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
    patch: UpdateAssetImpairmentInput,
    manager?: EntityManager,
  ): Promise<AssetImpairmentEntity> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(AssetImpairmentEntity) : this.repo;
    await repo.update({ id, organizationId }, patch);
    const updated = await repo.findOne({ where: { id, organizationId } });
    if (!updated) {
      throw new Error(
        `AssetImpairment ${id} disappeared after UPDATE in org ${organizationId}`,
      );
    }
    return updated;
  }
}
