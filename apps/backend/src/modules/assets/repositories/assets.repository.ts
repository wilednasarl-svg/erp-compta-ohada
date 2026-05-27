import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AssetEntity } from '../entities/asset.entity';
import type { AssetStatus, DepreciationMethod } from '../types/asset.types';

export interface CreateAssetInput {
  readonly organizationId: TenantId | string;
  readonly code: string;
  readonly label: string;
  readonly acquisitionDate: string;
  readonly putInServiceDate: string;
  readonly acquisitionCost: string;
  readonly residualValue?: string;
  readonly depreciationMethod: DepreciationMethod;
  readonly durationMonths: number;
  readonly decliningRate?: string | null;
  readonly assetAccountId: string;
  readonly depreciationAccountId: string;
  readonly expenseAccountId: string;
  readonly status?: AssetStatus;
  readonly createdById?: string | null;
  // W4.3 — UOP
  readonly totalUnits?: string | null;
  readonly unitsPerYear?: number[] | null;
  // W4.3 — Dérogatoire
  readonly derogatoryEnabled?: boolean;
  readonly derogatoryFiscalMethod?: DepreciationMethod | null;
  readonly derogatoryFiscalDuration?: number | null;
  readonly derogatoryFiscalDecliningRate?: string | null;
}

export interface UpdateAssetInput {
  readonly label?: string;
  readonly acquisitionDate?: string;
  readonly putInServiceDate?: string;
  readonly acquisitionCost?: string;
  readonly residualValue?: string;
  readonly depreciationMethod?: DepreciationMethod;
  readonly durationMonths?: number;
  readonly decliningRate?: string | null;
  readonly assetAccountId?: string;
  readonly depreciationAccountId?: string;
  readonly expenseAccountId?: string;
  readonly status?: AssetStatus;
  readonly disposalDate?: string | null;
  readonly disposalValue?: string | null;
}

@Injectable()
export class AssetsRepository {
  constructor(
    @InjectRepository(AssetEntity)
    private readonly repo: Repository<AssetEntity>,
  ) {}

  async create(input: CreateAssetInput, manager?: EntityManager): Promise<AssetEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(AssetEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      code: input.code,
      label: input.label,
      acquisitionDate: input.acquisitionDate,
      putInServiceDate: input.putInServiceDate,
      acquisitionCost: input.acquisitionCost,
      residualValue: input.residualValue ?? '0.00',
      depreciationMethod: input.depreciationMethod,
      durationMonths: input.durationMonths,
      decliningRate: input.decliningRate ?? null,
      assetAccountId: input.assetAccountId,
      depreciationAccountId: input.depreciationAccountId,
      expenseAccountId: input.expenseAccountId,
      status: input.status ?? 'active',
      createdById: input.createdById ?? null,
      // W4.3 — UOP + dérogatoire
      totalUnits: input.totalUnits ?? null,
      unitsPerYear: input.unitsPerYear ?? null,
      derogatoryEnabled: input.derogatoryEnabled ?? false,
      derogatoryFiscalMethod: input.derogatoryFiscalMethod ?? null,
      derogatoryFiscalDuration: input.derogatoryFiscalDuration ?? null,
      derogatoryFiscalDecliningRate: input.derogatoryFiscalDecliningRate ?? null,
    });
    return repo.save(entity);
  }

  async findById(id: string, organizationId: TenantId | string): Promise<AssetEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findByCode(organizationId: TenantId | string, code: string): Promise<AssetEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { organizationId, code } });
  }

  async listByOrganization(organizationId: TenantId | string): Promise<AssetEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId },
      order: { acquisitionDate: 'DESC', code: 'ASC' },
    });
  }

  async update(
    id: string,
    organizationId: TenantId | string,
    patch: UpdateAssetInput,
    manager?: EntityManager,
  ): Promise<AssetEntity> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(AssetEntity) : this.repo;
    await repo.update({ id, organizationId }, patch);
    const updated = await repo.findOne({ where: { id, organizationId } });
    if (!updated) {
      throw new Error(`Asset ${id} disappeared after UPDATE in org ${organizationId}`);
    }
    return updated;
  }

  async delete(
    id: string,
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(AssetEntity) : this.repo;
    await repo.delete({ id, organizationId });
  }
}
