import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { BudgetLineEntity } from '../entities/budget-line.entity';
import type { BudgetLineStatus, BudgetScenario, BudgetType } from '../types/budget.types';

/** Coordonnées analytiques d'une ligne (clé naturelle, hors période/montant). */
export interface BudgetLineAxes {
  readonly costCenterAxisId?: string | null;
  readonly projectAxisId?: string | null;
  readonly agencyAxisId?: string | null;
  readonly productAxisId?: string | null;
}

export interface CreateBudgetLineInput extends BudgetLineAxes {
  readonly organizationId: TenantId | string;
  readonly fiscalYear: number;
  readonly periodMonth?: number | null;
  readonly budgetType: BudgetType;
  readonly scenario: BudgetScenario;
  readonly accountCode: string;
  readonly accountLabel?: string | null;
  readonly amount: string;
  readonly currency: string;
  readonly exchangeRate: string;
  readonly amountBase: string;
  readonly comment?: string | null;
  readonly hypothesis?: string | null;
  readonly status?: BudgetLineStatus;
  readonly createdById?: string | null;
}

export interface UpdateBudgetLineInput {
  readonly accountLabel?: string | null;
  readonly amount?: string;
  readonly currency?: string;
  readonly exchangeRate?: string;
  readonly amountBase?: string;
  readonly comment?: string | null;
  readonly hypothesis?: string | null;
}

export interface ListBudgetLinesFilter {
  readonly fiscalYear?: number;
  readonly periodMonth?: number | null;
  readonly budgetType?: BudgetType;
  readonly scenario?: BudgetScenario;
  readonly accountCode?: string;
  readonly costCenterAxisId?: string;
  readonly projectAxisId?: string;
  readonly status?: BudgetLineStatus;
  readonly limit?: number;
  readonly offset?: number;
}

@Injectable()
export class BudgetLineRepository {
  constructor(
    @InjectRepository(BudgetLineEntity)
    private readonly repo: Repository<BudgetLineEntity>,
  ) {}

  async create(input: CreateBudgetLineInput, manager?: EntityManager): Promise<BudgetLineEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(BudgetLineEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      fiscalYear: input.fiscalYear,
      periodMonth: input.periodMonth ?? null,
      budgetType: input.budgetType,
      scenario: input.scenario,
      accountCode: input.accountCode,
      accountLabel: input.accountLabel ?? null,
      costCenterAxisId: input.costCenterAxisId ?? null,
      projectAxisId: input.projectAxisId ?? null,
      agencyAxisId: input.agencyAxisId ?? null,
      productAxisId: input.productAxisId ?? null,
      amount: input.amount,
      currency: input.currency,
      exchangeRate: input.exchangeRate,
      amountBase: input.amountBase,
      comment: input.comment ?? null,
      hypothesis: input.hypothesis ?? null,
      status: input.status ?? 'brouillon',
      createdById: input.createdById ?? null,
    });
    return repo.save(entity);
  }

  async findById(id: string, organizationId: TenantId | string): Promise<BudgetLineEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  /**
   * Recherche une ligne par sa clé naturelle (couple comptable+analytique+
   * temps+scénario) pour appliquer la règle d'unicité / l'upsert d'import.
   * Les axes absents sont comparés à `IS NULL` (cohérent avec l'index
   * unique COALESCE de la migration 0111).
   */
  async findByNaturalKey(
    organizationId: TenantId | string,
    key: {
      readonly fiscalYear: number;
      readonly periodMonth: number | null;
      readonly budgetType: BudgetType;
      readonly scenario: BudgetScenario;
      readonly accountCode: string;
    } & BudgetLineAxes,
  ): Promise<BudgetLineEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: {
        organizationId,
        fiscalYear: key.fiscalYear,
        periodMonth: key.periodMonth ?? IsNull(),
        budgetType: key.budgetType,
        scenario: key.scenario,
        accountCode: key.accountCode,
        costCenterAxisId: key.costCenterAxisId ?? IsNull(),
        projectAxisId: key.projectAxisId ?? IsNull(),
        agencyAxisId: key.agencyAxisId ?? IsNull(),
        productAxisId: key.productAxisId ?? IsNull(),
      },
    });
  }

  async list(
    organizationId: TenantId | string,
    filter: ListBudgetLinesFilter = {},
  ): Promise<{ rows: BudgetLineEntity[]; total: number }> {
    assertTenantId(organizationId);
    const qb = this.repo
      .createQueryBuilder('line')
      .where('line.organization_id = :organizationId', { organizationId });

    if (filter.fiscalYear !== undefined) {
      qb.andWhere('line.fiscal_year = :fiscalYear', { fiscalYear: filter.fiscalYear });
    }
    if (filter.periodMonth !== undefined && filter.periodMonth !== null) {
      qb.andWhere('line.period_month = :periodMonth', { periodMonth: filter.periodMonth });
    }
    if (filter.budgetType) {
      qb.andWhere('line.budget_type = :budgetType', { budgetType: filter.budgetType });
    }
    if (filter.scenario) {
      qb.andWhere('line.scenario = :scenario', { scenario: filter.scenario });
    }
    if (filter.accountCode) {
      qb.andWhere('line.account_code = :accountCode', { accountCode: filter.accountCode });
    }
    if (filter.costCenterAxisId) {
      qb.andWhere('line.cost_center_axis_id = :ccId', { ccId: filter.costCenterAxisId });
    }
    if (filter.projectAxisId) {
      qb.andWhere('line.project_axis_id = :projId', { projId: filter.projectAxisId });
    }
    if (filter.status) {
      qb.andWhere('line.status = :status', { status: filter.status });
    }

    qb.orderBy('line.fiscal_year', 'DESC')
      .addOrderBy('line.period_month', 'ASC')
      .addOrderBy('line.account_code', 'ASC')
      .take(filter.limit ?? 100)
      .skip(filter.offset ?? 0);

    const [rows, total] = await qb.getManyAndCount();
    return { rows, total };
  }

  async update(
    entity: BudgetLineEntity,
    input: UpdateBudgetLineInput & { status?: BudgetLineStatus; validatedById?: string | null },
    manager?: EntityManager,
  ): Promise<BudgetLineEntity> {
    const repo = manager ? manager.getRepository(BudgetLineEntity) : this.repo;
    const next = repo.create({
      ...entity,
      accountLabel: input.accountLabel === undefined ? entity.accountLabel : input.accountLabel,
      amount: input.amount ?? entity.amount,
      currency: input.currency ?? entity.currency,
      exchangeRate: input.exchangeRate ?? entity.exchangeRate,
      amountBase: input.amountBase ?? entity.amountBase,
      comment: input.comment === undefined ? entity.comment : input.comment,
      hypothesis: input.hypothesis === undefined ? entity.hypothesis : input.hypothesis,
      status: input.status ?? entity.status,
      validatedById: input.validatedById === undefined ? entity.validatedById : input.validatedById,
    });
    return repo.save(next);
  }

  async delete(entity: BudgetLineEntity, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(BudgetLineEntity) : this.repo;
    await repo.remove(entity);
  }
}
