import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import {
  type FxReevaluationAccountDetail,
  FxReevaluationRunEntity,
  type FxReevaluationStatus,
} from '../entities/fx-reevaluation-run.entity';

export interface CreateFxRunInput {
  readonly organizationId: TenantId | string;
  readonly closingDate: string;
  readonly reversalDate: string;
  readonly status?: FxReevaluationStatus;
  readonly executedAt?: Date | null;
  readonly executedById?: string | null;
  readonly journalEntryId?: string | null;
  readonly metadata?: ReadonlyArray<FxReevaluationAccountDetail>;
}

export interface UpdateFxRunInput {
  readonly status?: FxReevaluationStatus;
  readonly executedAt?: Date | null;
  readonly executedById?: string | null;
  readonly reversedAt?: Date | null;
  readonly journalEntryId?: string | null;
  readonly reversalJournalEntryId?: string | null;
  readonly metadata?: ReadonlyArray<FxReevaluationAccountDetail>;
  readonly errorMessage?: string | null;
}

export interface ListFxRunsFilters {
  readonly status?: FxReevaluationStatus;
  readonly closingDateFrom?: string;
  readonly closingDateTo?: string;
  readonly limit?: number;
}

@Injectable()
export class FxReevaluationRunsRepository {
  constructor(
    @InjectRepository(FxReevaluationRunEntity)
    private readonly repo: Repository<FxReevaluationRunEntity>,
  ) {}

  async create(
    input: CreateFxRunInput,
    manager?: EntityManager,
  ): Promise<FxReevaluationRunEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(FxReevaluationRunEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      closingDate: input.closingDate,
      reversalDate: input.reversalDate,
      status: input.status ?? 'pending',
      executedAt: input.executedAt ?? null,
      executedById: input.executedById ?? null,
      journalEntryId: input.journalEntryId ?? null,
      reversalJournalEntryId: null,
      reversedAt: null,
      metadata: input.metadata ?? [],
      errorMessage: null,
    });
    return repo.save(entity);
  }

  async update(
    id: string,
    patch: UpdateFxRunInput,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(FxReevaluationRunEntity) : this.repo;
    await repo.update({ id }, { ...patch });
  }

  async findById(
    organizationId: TenantId | string,
    id: string,
  ): Promise<FxReevaluationRunEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findByClosingDate(
    organizationId: TenantId | string,
    closingDate: string,
  ): Promise<FxReevaluationRunEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { organizationId, closingDate } });
  }

  async list(
    organizationId: TenantId | string,
    filters: ListFxRunsFilters = {},
  ): Promise<FxReevaluationRunEntity[]> {
    assertTenantId(organizationId);
    const qb = this.repo
      .createQueryBuilder('r')
      .where('r.organization_id = :organizationId', { organizationId })
      .orderBy('r.closing_date', 'DESC')
      .addOrderBy('r.created_at', 'DESC');

    if (filters.status) {
      qb.andWhere('r.status = :status', { status: filters.status });
    }
    if (filters.closingDateFrom) {
      qb.andWhere('r.closing_date >= :from::date', { from: filters.closingDateFrom });
    }
    if (filters.closingDateTo) {
      qb.andWhere('r.closing_date <= :to::date', { to: filters.closingDateTo });
    }
    const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 500) : 100;
    qb.limit(limit);
    return qb.getMany();
  }
}
