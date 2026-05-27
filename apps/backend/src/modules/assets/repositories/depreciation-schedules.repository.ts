import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { DepreciationScheduleEntity } from '../entities/depreciation-schedule.entity';
import type { DepreciationStatus } from '../types/asset.types';

export interface CreateDepreciationScheduleInput {
  readonly organizationId: TenantId | string;
  readonly assetId: string;
  readonly fiscalYear: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly depreciationAmount: string;
  readonly cumulativeDepreciation: string;
  readonly netBookValue: string;
  readonly status?: DepreciationStatus;
  // W4.3 — dérogatoire
  readonly economicAmount?: string | null;
  readonly fiscalAmount?: string | null;
  readonly derogatoryDotation?: string | null;
  readonly derogatoryReprise?: string | null;
}

export interface UpdateDepreciationScheduleInput {
  readonly status?: DepreciationStatus;
  readonly journalEntryId?: string | null;
  readonly postedAt?: Date | null;
  readonly postedById?: string | null;
}

@Injectable()
export class DepreciationSchedulesRepository {
  constructor(
    @InjectRepository(DepreciationScheduleEntity)
    private readonly repo: Repository<DepreciationScheduleEntity>,
  ) {}

  async createMany(
    inputs: CreateDepreciationScheduleInput[],
    manager?: EntityManager,
  ): Promise<DepreciationScheduleEntity[]> {
    if (inputs.length === 0) return [];
    const orgId = inputs[0].organizationId;
    assertTenantId(orgId);

    const repo = manager ? manager.getRepository(DepreciationScheduleEntity) : this.repo;
    const entities = inputs.map((input) => {
      assertTenantId(input.organizationId);
      return repo.create({
        organizationId: input.organizationId,
        assetId: input.assetId,
        fiscalYear: input.fiscalYear,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        depreciationAmount: input.depreciationAmount,
        cumulativeDepreciation: input.cumulativeDepreciation,
        netBookValue: input.netBookValue,
        status: input.status ?? 'pending',
        economicAmount: input.economicAmount ?? null,
        fiscalAmount: input.fiscalAmount ?? null,
        derogatoryDotation: input.derogatoryDotation ?? null,
        derogatoryReprise: input.derogatoryReprise ?? null,
      });
    });
    return repo.save(entities);
  }

  async deletePendingByAsset(
    assetId: string,
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(DepreciationScheduleEntity) : this.repo;
    await repo.delete({ assetId, organizationId, status: 'pending' });
  }

  async listByAsset(
    assetId: string,
    organizationId: TenantId | string,
  ): Promise<DepreciationScheduleEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { assetId, organizationId },
      order: { fiscalYear: 'ASC' },
    });
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<DepreciationScheduleEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async update(
    id: string,
    organizationId: TenantId | string,
    patch: UpdateDepreciationScheduleInput,
    manager?: EntityManager,
  ): Promise<DepreciationScheduleEntity> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(DepreciationScheduleEntity) : this.repo;
    await repo.update({ id, organizationId }, patch);
    const updated = await repo.findOne({ where: { id, organizationId } });
    if (!updated) {
      throw new Error(`Schedule ${id} disappeared after UPDATE in org ${organizationId}`);
    }
    return updated;
  }
}
