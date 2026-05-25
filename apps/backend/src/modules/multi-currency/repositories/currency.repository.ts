import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { CurrencyEntity } from '../entities/currency.entity';

export interface CreateCurrencyInput {
  readonly organizationId: TenantId | string;
  readonly code: string;
  readonly label: string;
  readonly decimalPlaces?: 0 | 2 | 3;
  readonly symbol?: string | null;
  readonly isActive?: boolean;
}

export interface UpdateCurrencyInput {
  readonly label?: string;
  readonly symbol?: string | null;
  readonly isActive?: boolean;
}

@Injectable()
export class CurrencyRepository {
  constructor(
    @InjectRepository(CurrencyEntity)
    private readonly repo: Repository<CurrencyEntity>,
  ) {}

  async create(input: CreateCurrencyInput, manager?: EntityManager): Promise<CurrencyEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(CurrencyEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      code: input.code.toUpperCase(),
      label: input.label,
      decimalPlaces: input.decimalPlaces ?? 2,
      symbol: input.symbol ?? null,
      isActive: input.isActive ?? true,
    });
    return repo.save(entity);
  }

  async findById(id: string, organizationId: TenantId | string): Promise<CurrencyEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findByCode(
    organizationId: TenantId | string,
    code: string,
  ): Promise<CurrencyEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { organizationId, code: code.toUpperCase() } });
  }

  async listByOrganization(
    organizationId: TenantId | string,
    options: { activeOnly?: boolean } = {},
  ): Promise<CurrencyEntity[]> {
    assertTenantId(organizationId);
    const where: Record<string, unknown> = { organizationId };
    if (options.activeOnly === true) where['isActive'] = true;
    return this.repo.find({ where, order: { code: 'ASC' } });
  }

  async update(
    id: string,
    organizationId: TenantId | string,
    patch: UpdateCurrencyInput,
  ): Promise<CurrencyEntity> {
    assertTenantId(organizationId);
    await this.repo.update({ id, organizationId }, patch);
    const updated = await this.repo.findOne({ where: { id, organizationId } });
    if (!updated) {
      throw new Error(`Currency ${id} disappeared after UPDATE in org ${organizationId}`);
    }
    return updated;
  }
}
