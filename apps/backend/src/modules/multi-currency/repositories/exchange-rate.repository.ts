import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThanOrEqual, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { ExchangeRateEntity } from '../entities/exchange-rate.entity';
import type { RateSource } from '../types/currency.types';

export interface CreateExchangeRateInput {
  readonly organizationId: TenantId | string;
  readonly fromCurrencyId: string;
  readonly toCurrencyId: string;
  readonly rateDate: string;
  readonly rate: string;
  readonly source?: RateSource;
  readonly sourceRef?: string | null;
  readonly createdById?: string | null;
}

export interface ListRatesFilters {
  readonly fromCurrencyId?: string;
  readonly toCurrencyId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly source?: RateSource;
  readonly limit?: number;
}

@Injectable()
export class ExchangeRateRepository {
  constructor(
    @InjectRepository(ExchangeRateEntity)
    private readonly repo: Repository<ExchangeRateEntity>,
  ) {}

  async create(
    input: CreateExchangeRateInput,
    manager?: EntityManager,
  ): Promise<ExchangeRateEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(ExchangeRateEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      fromCurrencyId: input.fromCurrencyId,
      toCurrencyId: input.toCurrencyId,
      rateDate: input.rateDate,
      rate: input.rate,
      source: input.source ?? 'manual',
      sourceRef: input.sourceRef ?? null,
      createdById: input.createdById ?? null,
    });
    return repo.save(entity);
  }

  /**
   * Read the most recent rate for a pair, as of `asOfDate` inclusive.
   * Returns null if no rate has ever been posted for the pair before
   * the date. Source priority is applied by `ExchangeRatesService`.
   */
  async findLatestForPair(
    organizationId: TenantId | string,
    fromCurrencyId: string,
    toCurrencyId: string,
    asOfDate: string,
  ): Promise<ExchangeRateEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: {
        organizationId,
        fromCurrencyId,
        toCurrencyId,
        rateDate: LessThanOrEqual(asOfDate),
      },
      order: { rateDate: 'DESC', createdAt: 'DESC' },
    });
  }

  async list(
    organizationId: TenantId | string,
    filters: ListRatesFilters = {},
  ): Promise<ExchangeRateEntity[]> {
    assertTenantId(organizationId);
    const qb = this.repo
      .createQueryBuilder('r')
      .where('r.organization_id = :organizationId', { organizationId })
      .orderBy('r.rate_date', 'DESC')
      .addOrderBy('r.created_at', 'DESC');

    if (filters.fromCurrencyId) {
      qb.andWhere('r.from_currency_id = :fromCurrencyId', {
        fromCurrencyId: filters.fromCurrencyId,
      });
    }
    if (filters.toCurrencyId) {
      qb.andWhere('r.to_currency_id = :toCurrencyId', { toCurrencyId: filters.toCurrencyId });
    }
    if (filters.fromDate) {
      qb.andWhere('r.rate_date >= :fromDate::date', { fromDate: filters.fromDate });
    }
    if (filters.toDate) {
      qb.andWhere('r.rate_date <= :toDate::date', { toDate: filters.toDate });
    }
    if (filters.source) {
      qb.andWhere('r.source = :source', { source: filters.source });
    }
    if (filters.limit && filters.limit > 0) {
      qb.limit(Math.min(filters.limit, 500));
    } else {
      qb.limit(100);
    }
    return qb.getMany();
  }

  async findByExactKey(
    organizationId: TenantId | string,
    fromCurrencyId: string,
    toCurrencyId: string,
    rateDate: string,
    source: RateSource,
  ): Promise<ExchangeRateEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: { organizationId, fromCurrencyId, toCurrencyId, rateDate, source },
    });
  }
}
