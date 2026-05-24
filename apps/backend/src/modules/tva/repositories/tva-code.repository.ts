import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { TvaCodeEntity } from '../entities/tva-code.entity';
import type { TvaCodeKind, TvaCodeType } from '../types/tva.types';

export interface CreateTvaCodeInput {
  readonly organizationId: TenantId | string;
  readonly code: string;
  readonly label: string;
  readonly rate: string;
  readonly type: TvaCodeType;
  readonly kind: TvaCodeKind;
  readonly isActive?: boolean;
}

export interface UpdateTvaCodeInput {
  readonly label?: string;
  readonly rate?: string;
  readonly type?: TvaCodeType;
  readonly kind?: TvaCodeKind;
  readonly isActive?: boolean;
}

@Injectable()
export class TvaCodeRepository {
  constructor(
    @InjectRepository(TvaCodeEntity)
    private readonly repo: Repository<TvaCodeEntity>,
  ) {}

  async create(input: CreateTvaCodeInput, manager?: EntityManager): Promise<TvaCodeEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(TvaCodeEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      code: input.code,
      label: input.label,
      rate: input.rate,
      type: input.type,
      kind: input.kind,
      isActive: input.isActive ?? true,
    });
    return repo.save(entity);
  }

  async findById(id: string, organizationId: TenantId | string): Promise<TvaCodeEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findByCode(
    organizationId: TenantId | string,
    code: string,
  ): Promise<TvaCodeEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { organizationId, code } });
  }

  async listByOrganization(
    organizationId: TenantId | string,
    options: { activeOnly?: boolean } = {},
  ): Promise<TvaCodeEntity[]> {
    assertTenantId(organizationId);
    const where = options.activeOnly
      ? { organizationId, isActive: true }
      : { organizationId };
    return this.repo.find({ where, order: { code: 'ASC' } });
  }

  async update(
    id: string,
    organizationId: TenantId | string,
    patch: UpdateTvaCodeInput,
  ): Promise<TvaCodeEntity> {
    assertTenantId(organizationId);
    await this.repo.update({ id, organizationId }, patch);
    const updated = await this.findById(id, organizationId);
    if (!updated) {
      throw new Error(`TvaCode ${id} disappeared after UPDATE in org ${organizationId}`);
    }
    return updated;
  }
}
