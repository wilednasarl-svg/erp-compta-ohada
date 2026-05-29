import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type QueryDeepPartialEntity } from 'typeorm';
import {
  CashFlowForecastEntity,
  CashFlowForecastStatus,
} from '../entities/cash-flow-forecast.entity';

@Injectable()
export class CashFlowForecastRepository {
  constructor(
    @InjectRepository(CashFlowForecastEntity)
    private readonly repo: Repository<CashFlowForecastEntity>,
  ) {}

  async create(data: Partial<CashFlowForecastEntity>): Promise<CashFlowForecastEntity> {
    const forecast = this.repo.create(data);
    return this.repo.save(forecast);
  }

  async findById(id: string, organizationId: string): Promise<CashFlowForecastEntity | null> {
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findAllForOrganization(
    organizationId: string,
    status?: CashFlowForecastStatus,
  ): Promise<CashFlowForecastEntity[]> {
    const query = this.repo
      .createQueryBuilder('cff')
      .where('cff.organization_id = :organizationId', { organizationId })
      .orderBy('cff.expected_date', 'ASC');

    if (status) {
      query.andWhere('cff.status = :status', { status });
    }

    return query.getMany();
  }

  async update(id: string, data: Partial<CashFlowForecastEntity>): Promise<void> {
    await this.repo.update({ id }, data as QueryDeepPartialEntity<CashFlowForecastEntity>);
  }

  async delete(id: string, organizationId: string): Promise<void> {
    await this.repo.delete({ id, organizationId });
  }
}
