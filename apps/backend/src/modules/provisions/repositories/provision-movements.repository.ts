import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { ProvisionMovementEntity } from '../entities/provision-movement.entity';
import type { ProvisionMovementKind } from '../types/provision.types';

export interface CreateProvisionMovementInput {
  readonly provisionId: string;
  readonly organizationId: TenantId | string;
  readonly kind: ProvisionMovementKind;
  readonly amount: string;
  readonly journalEntryId?: string | null;
  readonly effectiveDate: string;
  readonly note?: string | null;
  readonly createdById?: string | null;
}

@Injectable()
export class ProvisionMovementsRepository {
  constructor(
    @InjectRepository(ProvisionMovementEntity)
    private readonly repo: Repository<ProvisionMovementEntity>,
  ) {}

  async create(
    input: CreateProvisionMovementInput,
    manager?: EntityManager,
  ): Promise<ProvisionMovementEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(ProvisionMovementEntity) : this.repo;
    const entity = repo.create({
      provisionId: input.provisionId,
      organizationId: input.organizationId,
      kind: input.kind,
      amount: input.amount,
      journalEntryId: input.journalEntryId ?? null,
      effectiveDate: input.effectiveDate,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    });
    return repo.save(entity);
  }

  async listByProvision(
    provisionId: string,
    organizationId: TenantId | string,
  ): Promise<ProvisionMovementEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { provisionId, organizationId },
      order: { effectiveDate: 'DESC', createdAt: 'DESC' },
    });
  }
}
