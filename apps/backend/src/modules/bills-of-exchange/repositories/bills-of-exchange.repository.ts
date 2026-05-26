import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThanOrEqual, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { BillOfExchangeEntity } from '../entities/bill-of-exchange.entity';
import type { BillKind, BillStatus } from '../types/bill.types';

export interface CreateBillInput {
  readonly organizationId: TenantId | string;
  readonly kind: BillKind;
  readonly partnerAccountCode: string;
  readonly partnerName: string;
  readonly billNumber: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly nominalAmount: string;
  readonly status: BillStatus;
  readonly currentLocationAccount: string;
  readonly originalJournalEntryId?: string | null;
  readonly note?: string | null;
  readonly createdById?: string | null;
}

export interface UpdateBillInput {
  readonly status?: BillStatus;
  readonly currentLocationAccount?: string;
  readonly note?: string | null;
}

export interface ListBillsFilters {
  readonly kind?: BillKind;
  readonly status?: BillStatus;
  readonly dueBefore?: string;
}

@Injectable()
export class BillsOfExchangeRepository {
  constructor(
    @InjectRepository(BillOfExchangeEntity)
    private readonly repo: Repository<BillOfExchangeEntity>,
  ) {}

  async create(
    input: CreateBillInput,
    manager?: EntityManager,
  ): Promise<BillOfExchangeEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(BillOfExchangeEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      kind: input.kind,
      partnerAccountCode: input.partnerAccountCode,
      partnerName: input.partnerName,
      billNumber: input.billNumber,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      nominalAmount: input.nominalAmount,
      status: input.status,
      currentLocationAccount: input.currentLocationAccount,
      originalJournalEntryId: input.originalJournalEntryId ?? null,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    });
    return repo.save(entity);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<BillOfExchangeEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async listByOrganization(
    organizationId: TenantId | string,
    filters: ListBillsFilters = {},
  ): Promise<BillOfExchangeEntity[]> {
    assertTenantId(organizationId);
    const where: Record<string, unknown> = { organizationId };
    if (filters.kind) where.kind = filters.kind;
    if (filters.status) where.status = filters.status;
    if (filters.dueBefore) where.dueDate = LessThanOrEqual(filters.dueBefore);
    return this.repo.find({
      where,
      order: { dueDate: 'ASC', createdAt: 'DESC' },
    });
  }

  async update(
    id: string,
    organizationId: TenantId | string,
    patch: UpdateBillInput,
    manager?: EntityManager,
  ): Promise<BillOfExchangeEntity> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(BillOfExchangeEntity) : this.repo;
    await repo.update({ id, organizationId }, patch);
    const updated = await repo.findOne({ where: { id, organizationId } });
    if (!updated) {
      throw new Error(
        `Bill of exchange ${id} disappeared after UPDATE in org ${organizationId}`,
      );
    }
    return updated;
  }
}
