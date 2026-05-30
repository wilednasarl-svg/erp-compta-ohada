import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { FiscalParameterEntity } from '../entities/fiscal-parameter.entity';
import type {
  FiscalBaseKind,
  FiscalDeclarationKind,
  FiscalPeriodicity,
} from '../types/fiscal.types';

export interface CreateFiscalParameterInput {
  readonly organizationId: TenantId | string;
  readonly taxCode: string;
  readonly label: string;
  readonly declarationKind: FiscalDeclarationKind;
  readonly rate: string;
  readonly baseKind: FiscalBaseKind;
  readonly periodicity: FiscalPeriodicity;
  readonly ceiling?: string | null;
  readonly floorAmount?: string | null;
  readonly dueDay?: number;
  readonly chargeAccount?: string | null;
  readonly liabilityAccount?: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly isActive?: boolean;
  readonly notes?: string | null;
}

export interface UpdateFiscalParameterInput {
  readonly label?: string;
  readonly rate?: string;
  readonly ceiling?: string | null;
  readonly floorAmount?: string | null;
  readonly dueDay?: number;
  readonly chargeAccount?: string | null;
  readonly liabilityAccount?: string | null;
  readonly effectiveTo?: string | null;
  readonly isActive?: boolean;
  readonly notes?: string | null;
}

@Injectable()
export class FiscalParameterRepository {
  constructor(
    @InjectRepository(FiscalParameterEntity)
    private readonly repo: Repository<FiscalParameterEntity>,
  ) {}

  async create(
    input: CreateFiscalParameterInput,
    manager?: EntityManager,
  ): Promise<FiscalParameterEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(FiscalParameterEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      taxCode: input.taxCode,
      label: input.label,
      declarationKind: input.declarationKind,
      rate: input.rate,
      baseKind: input.baseKind,
      periodicity: input.periodicity,
      ceiling: input.ceiling ?? null,
      floorAmount: input.floorAmount ?? null,
      dueDay: input.dueDay ?? 15,
      chargeAccount: input.chargeAccount ?? null,
      liabilityAccount: input.liabilityAccount ?? null,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      isActive: input.isActive ?? true,
      notes: input.notes ?? null,
    });
    return repo.save(entity);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<FiscalParameterEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findByCodeAndDate(
    organizationId: TenantId | string,
    taxCode: string,
    effectiveFrom: string,
  ): Promise<FiscalParameterEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { organizationId, taxCode, effectiveFrom } });
  }

  /**
   * Paramètre actif applicable à une date : `effective_from <= date` et
   * (`effective_to` nul ou `>= date`), le plus récent d'abord.
   */
  async findEffective(
    organizationId: TenantId | string,
    taxCode: string,
    onDate: string,
  ): Promise<FiscalParameterEntity | null> {
    assertTenantId(organizationId);
    return this.repo
      .createQueryBuilder('p')
      .where('p.organization_id = :organizationId', { organizationId })
      .andWhere('p.tax_code = :taxCode', { taxCode })
      .andWhere('p.is_active = TRUE')
      .andWhere('p.effective_from <= :onDate', { onDate })
      .andWhere('(p.effective_to IS NULL OR p.effective_to >= :onDate)', { onDate })
      .orderBy('p.effective_from', 'DESC')
      .getOne();
  }

  async list(
    organizationId: TenantId | string,
    filter: { activeOnly?: boolean; declarationKind?: FiscalDeclarationKind } = {},
  ): Promise<FiscalParameterEntity[]> {
    assertTenantId(organizationId);
    const qb = this.repo
      .createQueryBuilder('p')
      .where('p.organization_id = :organizationId', { organizationId });
    if (filter.activeOnly) qb.andWhere('p.is_active = TRUE');
    if (filter.declarationKind) {
      qb.andWhere('p.declaration_kind = :kind', { kind: filter.declarationKind });
    }
    return qb.orderBy('p.tax_code', 'ASC').addOrderBy('p.effective_from', 'DESC').getMany();
  }

  async update(
    entity: FiscalParameterEntity,
    input: UpdateFiscalParameterInput,
    manager?: EntityManager,
  ): Promise<FiscalParameterEntity> {
    const repo = manager ? manager.getRepository(FiscalParameterEntity) : this.repo;
    const next = repo.create({
      ...entity,
      label: input.label ?? entity.label,
      rate: input.rate ?? entity.rate,
      ceiling: input.ceiling === undefined ? entity.ceiling : input.ceiling,
      floorAmount: input.floorAmount === undefined ? entity.floorAmount : input.floorAmount,
      dueDay: input.dueDay ?? entity.dueDay,
      chargeAccount: input.chargeAccount === undefined ? entity.chargeAccount : input.chargeAccount,
      liabilityAccount:
        input.liabilityAccount === undefined ? entity.liabilityAccount : input.liabilityAccount,
      effectiveTo: input.effectiveTo === undefined ? entity.effectiveTo : input.effectiveTo,
      isActive: input.isActive ?? entity.isActive,
      notes: input.notes === undefined ? entity.notes : input.notes,
    });
    return repo.save(next);
  }
}
