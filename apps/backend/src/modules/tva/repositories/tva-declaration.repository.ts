import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { TvaDeclarationEntity } from '../entities/tva-declaration.entity';
import type { TvaDeclarationStatus } from '../types/tva.types';

export interface CreateTvaDeclarationInput {
  readonly organizationId: TenantId | string;
  readonly periodYear: number;
  readonly periodMonth: number;
}

export interface ListDeclarationsFilters {
  readonly status?: TvaDeclarationStatus;
  readonly periodYear?: number;
}

@Injectable()
export class TvaDeclarationRepository {
  constructor(
    @InjectRepository(TvaDeclarationEntity)
    private readonly repo: Repository<TvaDeclarationEntity>,
  ) {}

  async create(input: CreateTvaDeclarationInput): Promise<TvaDeclarationEntity> {
    assertTenantId(input.organizationId);
    const entity = this.repo.create({
      organizationId: input.organizationId,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      status: 'draft',
    });
    return this.repo.save(entity);
  }

  async save(entity: TvaDeclarationEntity): Promise<TvaDeclarationEntity> {
    return this.repo.save(entity);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<TvaDeclarationEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: { id, organizationId },
      relations: { lines: true },
    });
  }

  async findActiveByPeriod(
    organizationId: TenantId | string,
    periodYear: number,
    periodMonth: number,
  ): Promise<TvaDeclarationEntity | null> {
    assertTenantId(organizationId);
    return this.repo
      .createQueryBuilder('d')
      .where('d.organization_id = :organizationId', { organizationId })
      .andWhere('d.period_year = :periodYear', { periodYear })
      .andWhere('d.period_month = :periodMonth', { periodMonth })
      .andWhere('d.status <> :cancelled', { cancelled: 'cancelled' })
      .getOne();
  }

  async listByOrganization(
    organizationId: TenantId | string,
    filters: ListDeclarationsFilters = {},
  ): Promise<TvaDeclarationEntity[]> {
    assertTenantId(organizationId);
    const qb = this.repo
      .createQueryBuilder('d')
      .where('d.organization_id = :organizationId', { organizationId })
      .orderBy('d.period_year', 'DESC')
      .addOrderBy('d.period_month', 'DESC');

    if (filters.status) {
      qb.andWhere('d.status = :status', { status: filters.status });
    }
    if (filters.periodYear !== undefined) {
      qb.andWhere('d.period_year = :periodYear', { periodYear: filters.periodYear });
    }

    return qb.getMany();
  }
}
