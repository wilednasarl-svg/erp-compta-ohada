import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { BillEventEntity } from '../entities/bill-event.entity';
import type { BillEventType } from '../types/bill.types';

export interface CreateBillEventInput {
  readonly billId: string;
  readonly organizationId: TenantId | string;
  readonly eventType: BillEventType;
  readonly eventDate: string;
  readonly amount: string;
  readonly discountFee?: string | null;
  readonly bankFee?: string | null;
  readonly netAmount?: string | null;
  readonly journalEntryId?: string | null;
  readonly note?: string | null;
  readonly createdById?: string | null;
}

@Injectable()
export class BillEventsRepository {
  constructor(
    @InjectRepository(BillEventEntity)
    private readonly repo: Repository<BillEventEntity>,
  ) {}

  async create(input: CreateBillEventInput, manager?: EntityManager): Promise<BillEventEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(BillEventEntity) : this.repo;
    const entity = repo.create({
      billId: input.billId,
      organizationId: input.organizationId,
      eventType: input.eventType,
      eventDate: input.eventDate,
      amount: input.amount,
      discountFee: input.discountFee ?? null,
      bankFee: input.bankFee ?? null,
      netAmount: input.netAmount ?? null,
      journalEntryId: input.journalEntryId ?? null,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    });
    return repo.save(entity);
  }

  async listByBill(billId: string, organizationId: TenantId | string): Promise<BillEventEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { billId, organizationId },
      order: { eventDate: 'DESC', createdAt: 'DESC' },
    });
  }
}
