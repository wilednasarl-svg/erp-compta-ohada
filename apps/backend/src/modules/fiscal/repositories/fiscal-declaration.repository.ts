import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { FiscalDeclarationEntity } from '../entities/fiscal-declaration.entity';
import type { FiscalDeclarationStatus } from '../types/fiscal.types';

export interface CreateFiscalDeclarationInput {
  readonly organizationId: TenantId | string;
  readonly taxCode: string;
  readonly label?: string | null;
  readonly periodYear: number;
  readonly periodMonth?: number | null;
  readonly baseAmount: string;
  readonly rate: string;
  readonly amountDue: string;
  readonly currency?: string;
  readonly dueDate: string;
  readonly chargeAccount?: string | null;
  readonly liabilityAccount?: string | null;
  readonly comment?: string | null;
  readonly createdById?: string | null;
}

export interface UpdateFiscalDeclarationInput {
  readonly baseAmount?: string;
  readonly rate?: string;
  readonly amountDue?: string;
  readonly dueDate?: string;
  readonly reference?: string | null;
  readonly justificatifUrl?: string | null;
  readonly comment?: string | null;
  readonly status?: FiscalDeclarationStatus;
  readonly validatedById?: string | null;
}

export interface ListFiscalDeclarationsFilter {
  readonly periodYear?: number;
  readonly periodMonth?: number | null;
  readonly taxCode?: string;
  readonly status?: FiscalDeclarationStatus;
  readonly dueBefore?: string;
  readonly limit?: number;
  readonly offset?: number;
}

@Injectable()
export class FiscalDeclarationRepository {
  constructor(
    @InjectRepository(FiscalDeclarationEntity)
    private readonly repo: Repository<FiscalDeclarationEntity>,
  ) {}

  async create(
    input: CreateFiscalDeclarationInput,
    manager?: EntityManager,
  ): Promise<FiscalDeclarationEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(FiscalDeclarationEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      taxCode: input.taxCode,
      label: input.label ?? null,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth ?? null,
      baseAmount: input.baseAmount,
      rate: input.rate,
      amountDue: input.amountDue,
      currency: input.currency ?? 'XOF',
      dueDate: input.dueDate,
      chargeAccount: input.chargeAccount ?? null,
      liabilityAccount: input.liabilityAccount ?? null,
      comment: input.comment ?? null,
      createdById: input.createdById ?? null,
    });
    return repo.save(entity);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<FiscalDeclarationEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findByNaturalKey(
    organizationId: TenantId | string,
    taxCode: string,
    periodYear: number,
    periodMonth: number | null,
  ): Promise<FiscalDeclarationEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: {
        organizationId,
        taxCode,
        periodYear,
        periodMonth: periodMonth ?? IsNull(),
      },
    });
  }

  async list(
    organizationId: TenantId | string,
    filter: ListFiscalDeclarationsFilter = {},
  ): Promise<{ rows: FiscalDeclarationEntity[]; total: number }> {
    assertTenantId(organizationId);
    const qb = this.repo
      .createQueryBuilder('d')
      .where('d.organization_id = :organizationId', { organizationId });

    if (filter.periodYear !== undefined) {
      qb.andWhere('d.period_year = :periodYear', { periodYear: filter.periodYear });
    }
    if (filter.periodMonth !== undefined && filter.periodMonth !== null) {
      qb.andWhere('d.period_month = :periodMonth', { periodMonth: filter.periodMonth });
    }
    if (filter.taxCode) {
      qb.andWhere('d.tax_code = :taxCode', { taxCode: filter.taxCode });
    }
    if (filter.status) {
      qb.andWhere('d.status = :status', { status: filter.status });
    }
    if (filter.dueBefore) {
      qb.andWhere('d.due_date <= :dueBefore', { dueBefore: filter.dueBefore });
    }

    qb.orderBy('d.due_date', 'ASC')
      .addOrderBy('d.tax_code', 'ASC')
      .take(filter.limit ?? 200)
      .skip(filter.offset ?? 0);

    const [rows, total] = await qb.getManyAndCount();
    return { rows, total };
  }

  async update(
    entity: FiscalDeclarationEntity,
    input: UpdateFiscalDeclarationInput,
    manager?: EntityManager,
  ): Promise<FiscalDeclarationEntity> {
    const repo = manager ? manager.getRepository(FiscalDeclarationEntity) : this.repo;
    const next = repo.create({
      ...entity,
      baseAmount: input.baseAmount ?? entity.baseAmount,
      rate: input.rate ?? entity.rate,
      amountDue: input.amountDue ?? entity.amountDue,
      dueDate: input.dueDate ?? entity.dueDate,
      reference: input.reference === undefined ? entity.reference : input.reference,
      justificatifUrl:
        input.justificatifUrl === undefined ? entity.justificatifUrl : input.justificatifUrl,
      comment: input.comment === undefined ? entity.comment : input.comment,
      status: input.status ?? entity.status,
      validatedById: input.validatedById === undefined ? entity.validatedById : input.validatedById,
    });
    return repo.save(next);
  }
}
