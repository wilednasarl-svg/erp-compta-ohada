import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { ActuarialCommitmentEntity } from '../entities/actuarial-commitment.entity';
import type {
  ActuarialCommitmentStatus,
  ActuarialCommitmentType,
} from '../types/actuarial-commitment.types';

export interface CreateActuarialCommitmentInput {
  readonly organizationId: TenantId | string;
  readonly commitmentType: ActuarialCommitmentType;
  readonly label: string;
  readonly valuationDate: string;
  readonly obligationAmount: string;
  readonly provisionedAmount: string;
  readonly discountRate: string;
  readonly mortalityTable: string;
  readonly staffTurnover?: string | null;
  readonly salaryGrowthRate?: string | null;
  readonly methodology: string;
  readonly actuaryName?: string | null;
  readonly comment?: string | null;
  readonly createdById?: string | null;
}

export interface UpdateActuarialCommitmentInput {
  readonly label?: string;
  readonly valuationDate?: string;
  readonly obligationAmount?: string;
  readonly provisionedAmount?: string;
  readonly discountRate?: string;
  readonly mortalityTable?: string;
  readonly staffTurnover?: string | null;
  readonly salaryGrowthRate?: string | null;
  readonly methodology?: string;
  readonly actuaryName?: string | null;
  readonly comment?: string | null;
  readonly status?: ActuarialCommitmentStatus;
}

export interface ListActuarialCommitmentsFilters {
  readonly status?: ActuarialCommitmentStatus;
  readonly commitmentType?: ActuarialCommitmentType;
}

@Injectable()
export class ActuarialCommitmentsRepository {
  constructor(
    @InjectRepository(ActuarialCommitmentEntity)
    private readonly repo: Repository<ActuarialCommitmentEntity>,
  ) {}

  async create(input: CreateActuarialCommitmentInput): Promise<ActuarialCommitmentEntity> {
    assertTenantId(input.organizationId);
    const entity = this.repo.create({
      organizationId: input.organizationId,
      commitmentType: input.commitmentType,
      label: input.label,
      valuationDate: input.valuationDate,
      obligationAmount: input.obligationAmount,
      provisionedAmount: input.provisionedAmount,
      discountRate: input.discountRate,
      mortalityTable: input.mortalityTable,
      staffTurnover: input.staffTurnover ?? null,
      salaryGrowthRate: input.salaryGrowthRate ?? null,
      methodology: input.methodology,
      actuaryName: input.actuaryName ?? null,
      status: 'active',
      comment: input.comment ?? null,
      createdById: input.createdById ?? null,
    });
    return this.repo.save(entity);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<ActuarialCommitmentEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async listByOrganization(
    organizationId: TenantId | string,
    filters: ListActuarialCommitmentsFilters = {},
  ): Promise<ActuarialCommitmentEntity[]> {
    assertTenantId(organizationId);
    const where: Record<string, unknown> = { organizationId };
    if (filters.status) where.status = filters.status;
    if (filters.commitmentType) where.commitmentType = filters.commitmentType;
    return this.repo.find({
      where,
      order: { valuationDate: 'DESC', createdAt: 'DESC' },
    });
  }

  /**
   * Renvoie l'évaluation active la plus récente pour un type donné.
   * Utilisé par le handler N16B pour ne pas additionner deux évaluations
   * successives du même type (la nouvelle remplace la précédente).
   */
  async findLatestActiveByType(
    organizationId: TenantId | string,
    commitmentType: ActuarialCommitmentType,
  ): Promise<ActuarialCommitmentEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: { organizationId, commitmentType, status: 'active' },
      order: { valuationDate: 'DESC', createdAt: 'DESC' },
    });
  }

  /**
   * Liste les engagements actifs dont la `valuation_date <= asAtDate`.
   * Utilisé par `sumOffBalanceSheetAsOf` côté service.
   */
  async listActiveAsOf(
    organizationId: TenantId | string,
    asAtDate: string,
  ): Promise<ActuarialCommitmentEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: {
        organizationId,
        status: 'active',
        valuationDate: LessThanOrEqual(asAtDate),
      },
      order: { valuationDate: 'DESC', createdAt: 'DESC' },
    });
  }

  async update(
    id: string,
    organizationId: TenantId | string,
    patch: UpdateActuarialCommitmentInput,
  ): Promise<ActuarialCommitmentEntity> {
    assertTenantId(organizationId);
    await this.repo.update({ id, organizationId }, patch);
    const updated = await this.repo.findOne({ where: { id, organizationId } });
    if (!updated) {
      throw new Error(
        `ActuarialCommitment ${id} disappeared after UPDATE in org ${organizationId}`,
      );
    }
    return updated;
  }
}
