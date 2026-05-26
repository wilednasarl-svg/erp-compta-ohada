import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { LeasePaymentEntity } from '../entities/lease-payment.entity';

export interface CreateLeasePaymentInput {
  readonly leaseId: string;
  readonly installmentId: string;
  readonly organizationId: TenantId | string;
  readonly paymentDate: string;
  readonly amount: string;
  readonly interestPart: string;
  readonly capitalPart: string;
  readonly journalEntryId?: string | null;
  readonly note?: string | null;
  readonly createdById?: string | null;
}

@Injectable()
export class LeasePaymentsRepository {
  constructor(
    @InjectRepository(LeasePaymentEntity)
    private readonly repo: Repository<LeasePaymentEntity>,
  ) {}

  async create(
    input: CreateLeasePaymentInput,
    manager?: EntityManager,
  ): Promise<LeasePaymentEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(LeasePaymentEntity) : this.repo;
    const entity = repo.create({
      leaseId: input.leaseId,
      installmentId: input.installmentId,
      organizationId: input.organizationId,
      paymentDate: input.paymentDate,
      amount: input.amount,
      interestPart: input.interestPart,
      capitalPart: input.capitalPart,
      journalEntryId: input.journalEntryId ?? null,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    });
    return repo.save(entity);
  }

  async listByLease(
    leaseId: string,
    organizationId: TenantId | string,
  ): Promise<LeasePaymentEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { leaseId, organizationId },
      order: { paymentDate: 'ASC', createdAt: 'ASC' },
    });
  }
}
