import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { SocialPayrollLineEntity } from '../entities/social-payroll-line.entity';

export interface UpsertPayrollLineInput {
  readonly organizationId: TenantId | string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly employeeRef: string;
  readonly grossSalary: string;
  readonly createdById?: string | null;
}

@Injectable()
export class SocialPayrollRepository {
  constructor(
    @InjectRepository(SocialPayrollLineEntity)
    private readonly repo: Repository<SocialPayrollLineEntity>,
  ) {}

  async findByNaturalKey(
    organizationId: TenantId | string,
    periodYear: number,
    periodMonth: number,
    employeeRef: string,
  ): Promise<SocialPayrollLineEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { organizationId, periodYear, periodMonth, employeeRef } });
  }

  /** Insère ou met à jour le brut d'un salarié pour la période. */
  async upsert(
    input: UpsertPayrollLineInput,
    manager?: EntityManager,
  ): Promise<SocialPayrollLineEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(SocialPayrollLineEntity) : this.repo;
    const existing = await this.findByNaturalKey(
      input.organizationId,
      input.periodYear,
      input.periodMonth,
      input.employeeRef,
    );
    if (existing) {
      const next = repo.create({ ...existing, grossSalary: input.grossSalary });
      return repo.save(next);
    }
    const entity = repo.create({
      organizationId: input.organizationId,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      employeeRef: input.employeeRef,
      grossSalary: input.grossSalary,
      createdById: input.createdById ?? null,
    });
    return repo.save(entity);
  }

  async listForPeriod(
    organizationId: TenantId | string,
    periodYear: number,
    periodMonth: number,
  ): Promise<SocialPayrollLineEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, periodYear, periodMonth },
      order: { employeeRef: 'ASC' },
    });
  }

  async deleteById(id: string, organizationId: TenantId | string): Promise<boolean> {
    assertTenantId(organizationId);
    const res = await this.repo.delete({ id, organizationId });
    return (res.affected ?? 0) > 0;
  }
}
