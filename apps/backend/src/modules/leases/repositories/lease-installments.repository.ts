import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { LeaseInstallmentEntity } from '../entities/lease-installment.entity';

export interface CreateLeaseInstallmentInput {
  readonly leaseId: string;
  readonly organizationId: TenantId | string;
  readonly dueDate: string;
  readonly installmentNumber: number;
  readonly totalAmount: string;
  readonly interestPart: string;
  readonly capitalPart: string;
  readonly outstandingBalance: string;
}

@Injectable()
export class LeaseInstallmentsRepository {
  constructor(
    @InjectRepository(LeaseInstallmentEntity)
    private readonly repo: Repository<LeaseInstallmentEntity>,
  ) {}

  async createMany(
    inputs: ReadonlyArray<CreateLeaseInstallmentInput>,
    manager?: EntityManager,
  ): Promise<LeaseInstallmentEntity[]> {
    if (inputs.length === 0) return [];
    for (const input of inputs) {
      assertTenantId(input.organizationId);
    }
    const repo = manager ? manager.getRepository(LeaseInstallmentEntity) : this.repo;
    const entities = inputs.map((input) =>
      repo.create({
        leaseId: input.leaseId,
        organizationId: input.organizationId,
        dueDate: input.dueDate,
        installmentNumber: input.installmentNumber,
        totalAmount: input.totalAmount,
        interestPart: input.interestPart,
        capitalPart: input.capitalPart,
        outstandingBalance: input.outstandingBalance,
        paid: false,
      }),
    );
    return repo.save(entities);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<LeaseInstallmentEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async listByLease(
    leaseId: string,
    organizationId: TenantId | string,
  ): Promise<LeaseInstallmentEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { leaseId, organizationId },
      order: { installmentNumber: 'ASC' },
    });
  }

  async markPaid(
    id: string,
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<LeaseInstallmentEntity> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(LeaseInstallmentEntity) : this.repo;
    await repo.update({ id, organizationId }, { paid: true });
    const updated = await repo.findOne({ where: { id, organizationId } });
    if (!updated) {
      throw new Error(`LeaseInstallment ${id} disappeared after mark paid`);
    }
    return updated;
  }
}
