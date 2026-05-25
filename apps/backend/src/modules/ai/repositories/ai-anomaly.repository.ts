import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AiAnomalyEntity } from '../entities/ai-anomaly.entity';
import type { AnomalyType } from '../types/ai.types';

export interface UpsertAnomalyInput {
  readonly organizationId: TenantId | string;
  readonly periodId: string | null;
  readonly entryId: string | null;
  readonly accountId: string | null;
  readonly anomalyType: AnomalyType;
  readonly riskScore: number;
  readonly reasons: ReadonlyArray<string>;
}

export interface ListAnomaliesFilters {
  readonly periodId?: string;
  readonly entryId?: string;
  readonly accountId?: string;
  readonly anomalyType?: AnomalyType;
  readonly minScore?: number;
  readonly page?: number;
  readonly pageSize?: number;
}

@Injectable()
export class AiAnomalyRepository {
  constructor(
    @InjectRepository(AiAnomalyEntity)
    private readonly repo: Repository<AiAnomalyEntity>,
  ) {}

  async upsert(input: UpsertAnomalyInput, manager?: EntityManager): Promise<void> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(AiAnomalyEntity) : this.repo;

    if (input.entryId !== null) {
      await repo
        .createQueryBuilder()
        .insert()
        .into(AiAnomalyEntity)
        .values({
          organizationId: input.organizationId,
          periodId: input.periodId,
          entryId: input.entryId,
          accountId: input.accountId,
          anomalyType: input.anomalyType,
          riskScore: input.riskScore,
          reasons: [...input.reasons],
          detectedBy: 'heuristic_v1',
          detectedAt: new Date(),
        })
        .onConflict(
          `("organization_id", "entry_id", "anomaly_type") WHERE "entry_id" IS NOT NULL DO UPDATE SET
           "risk_score" = EXCLUDED."risk_score",
           "reasons" = EXCLUDED."reasons",
           "detected_at" = EXCLUDED."detected_at"`,
        )
        .execute();
      return;
    }

    if (input.accountId === null) {
      throw new Error(
        'AiAnomalyRepository.upsert: at least one of entry_id or account_id must be set',
      );
    }

    await repo
      .createQueryBuilder()
      .insert()
      .into(AiAnomalyEntity)
      .values({
        organizationId: input.organizationId,
        periodId: input.periodId,
        entryId: null,
        accountId: input.accountId,
        anomalyType: input.anomalyType,
        riskScore: input.riskScore,
        reasons: [...input.reasons],
        detectedBy: 'heuristic_v1',
        detectedAt: new Date(),
      })
      .onConflict(
        `("organization_id", "account_id", "anomaly_type")
         WHERE "entry_id" IS NULL AND "account_id" IS NOT NULL DO UPDATE SET
         "risk_score" = EXCLUDED."risk_score",
         "reasons" = EXCLUDED."reasons",
         "detected_at" = EXCLUDED."detected_at",
         "period_id" = EXCLUDED."period_id"`,
      )
      .execute();
  }

  async deleteByPeriod(
    organizationId: TenantId | string,
    periodId: string,
    manager?: EntityManager,
  ): Promise<number> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(AiAnomalyEntity) : this.repo;
    const result = await repo.delete({ organizationId, periodId });
    return result.affected ?? 0;
  }

  async listForOrg(
    organizationId: TenantId | string,
    filters: ListAnomaliesFilters = {},
  ): Promise<{ anomalies: AiAnomalyEntity[]; total: number }> {
    assertTenantId(organizationId);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const qb = this.repo
      .createQueryBuilder('a')
      .where('a.organization_id = :organizationId', { organizationId });
    if (filters.periodId !== undefined)
      qb.andWhere('a.period_id = :periodId', { periodId: filters.periodId });
    if (filters.entryId !== undefined)
      qb.andWhere('a.entry_id = :entryId', { entryId: filters.entryId });
    if (filters.accountId !== undefined)
      qb.andWhere('a.account_id = :accountId', { accountId: filters.accountId });
    if (filters.anomalyType !== undefined)
      qb.andWhere('a.anomaly_type = :type', { type: filters.anomalyType });
    if (filters.minScore !== undefined)
      qb.andWhere('a.risk_score >= :minScore', { minScore: filters.minScore });
    qb.orderBy('a.risk_score', 'DESC').addOrderBy('a.detected_at', 'DESC');
    qb.skip((page - 1) * pageSize).take(pageSize);
    const [anomalies, total] = await qb.getManyAndCount();
    return { anomalies, total };
  }
}
