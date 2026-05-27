import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThanOrEqual, MoreThan, IsNull, Or, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { PledgedAssetEntity } from '../entities/pledged-asset.entity';
import type { PledgeStatus, PledgeType } from '../types/pledged-asset.types';

export interface CreatePledgedAssetInput {
  readonly organizationId: TenantId | string;
  readonly liabilityAccountCode: string;
  readonly liabilityLabel: string;
  readonly brutAmount: string;
  readonly pledgeType: PledgeType;
  readonly assetReference: string;
  readonly assetLocation?: string | null;
  readonly creditorName: string;
  readonly startDate: string;
  readonly endDate?: string | null;
  readonly comment?: string | null;
  readonly createdById?: string | null;
}

export interface UpdatePledgedAssetPatch {
  readonly liabilityAccountCode?: string;
  readonly liabilityLabel?: string;
  readonly brutAmount?: string;
  readonly pledgeType?: PledgeType;
  readonly assetReference?: string;
  readonly assetLocation?: string | null;
  readonly creditorName?: string;
  readonly startDate?: string;
  readonly endDate?: string | null;
  readonly comment?: string | null;
  readonly status?: PledgeStatus;
  readonly releasedAt?: Date | null;
}

export interface ListPledgedAssetsFilters {
  readonly status?: PledgeStatus;
  readonly pledgeType?: PledgeType;
}

/**
 * Repository tenant-scope des sûretés réelles données.
 *
 * Toutes les méthodes assertent `organizationId` via `assertTenantId`
 * pour garantir l'isolation multi-tenant (jamais de fallback global).
 */
@Injectable()
export class PledgedAssetsRepository {
  constructor(
    @InjectRepository(PledgedAssetEntity)
    private readonly repo: Repository<PledgedAssetEntity>,
  ) {}

  async create(
    input: CreatePledgedAssetInput,
    manager?: EntityManager,
  ): Promise<PledgedAssetEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(PledgedAssetEntity) : this.repo;
    const entity = repo.create({
      organizationId: String(input.organizationId),
      liabilityAccountCode: input.liabilityAccountCode,
      liabilityLabel: input.liabilityLabel,
      brutAmount: input.brutAmount,
      pledgeType: input.pledgeType,
      assetReference: input.assetReference,
      assetLocation: input.assetLocation ?? null,
      creditorName: input.creditorName,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      comment: input.comment ?? null,
      status: 'active',
      createdById: input.createdById ?? null,
      releasedAt: null,
    });
    return repo.save(entity);
  }

  async findById(
    organizationId: TenantId | string,
    id: string,
  ): Promise<PledgedAssetEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: { id, organizationId: String(organizationId) },
    });
  }

  async listByOrganization(
    organizationId: TenantId | string,
    filters: ListPledgedAssetsFilters = {},
  ): Promise<PledgedAssetEntity[]> {
    assertTenantId(organizationId);
    const where: Record<string, unknown> = { organizationId: String(organizationId) };
    if (filters.status) where.status = filters.status;
    if (filters.pledgeType) where.pledgeType = filters.pledgeType;
    return this.repo.find({
      where,
      order: { startDate: 'DESC', createdAt: 'DESC' },
    });
  }

  async update(
    organizationId: TenantId | string,
    id: string,
    patch: UpdatePledgedAssetPatch,
    manager?: EntityManager,
  ): Promise<PledgedAssetEntity> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(PledgedAssetEntity) : this.repo;
    await repo.update({ id, organizationId: String(organizationId) }, patch);
    const updated = await repo.findOne({
      where: { id, organizationId: String(organizationId) },
    });
    if (!updated) {
      throw new Error(
        `PledgedAsset ${id} disappeared after UPDATE in org ${String(organizationId)}`,
      );
    }
    return updated;
  }

  /**
   * Liste les sûretés actives à une date donnée (`asAtDate`). Une
   * sûreté est active à `asAtDate` si :
   *   - `status === 'active'`, ET
   *   - `startDate <= asAtDate`, ET
   *   - (`endDate IS NULL` OR `endDate > asAtDate`).
   *
   * Utilisé par les handlers de notes annexes (N1 et N16Bbis) pour
   * matérialiser le tableau doctrine à la date de clôture.
   */
  async listActiveAsOf(
    organizationId: TenantId | string,
    asAtDate: string,
  ): Promise<PledgedAssetEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: {
        organizationId: String(organizationId),
        status: 'active',
        startDate: LessThanOrEqual(asAtDate),
        endDate: Or(IsNull(), MoreThan(asAtDate)),
      },
      order: { startDate: 'DESC', createdAt: 'DESC' },
    });
  }
}
