import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { SubsidyReleaseEntity } from '../entities/subsidy-release.entity';

export interface CreateSubsidyReleaseInput {
  readonly subsidyId: string;
  readonly organizationId: TenantId | string;
  readonly releaseDate: string;
  readonly amount: string;
  readonly journalEntryId?: string | null;
  readonly relatedDepreciationScheduleId?: string | null;
  readonly createdById?: string | null;
}

@Injectable()
export class SubsidyReleasesRepository {
  constructor(
    @InjectRepository(SubsidyReleaseEntity)
    private readonly repo: Repository<SubsidyReleaseEntity>,
  ) {}

  async create(
    input: CreateSubsidyReleaseInput,
    manager?: EntityManager,
  ): Promise<SubsidyReleaseEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(SubsidyReleaseEntity) : this.repo;
    const entity = repo.create({
      subsidyId: input.subsidyId,
      organizationId: input.organizationId,
      releaseDate: input.releaseDate,
      amount: input.amount,
      journalEntryId: input.journalEntryId ?? null,
      relatedDepreciationScheduleId: input.relatedDepreciationScheduleId ?? null,
      createdById: input.createdById ?? null,
    });
    return repo.save(entity);
  }

  async listBySubsidy(
    subsidyId: string,
    organizationId: TenantId | string,
  ): Promise<SubsidyReleaseEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { subsidyId, organizationId },
      order: { releaseDate: 'DESC', createdAt: 'DESC' },
    });
  }
}
