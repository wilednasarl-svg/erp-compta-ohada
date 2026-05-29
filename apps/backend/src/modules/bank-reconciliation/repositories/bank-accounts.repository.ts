import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { BankAccountEntity } from '../entities/bank-account.entity';
import type { BankAccountStatus } from '../types/bank.types';

export interface CreateBankAccountInput {
  readonly organizationId: TenantId | string;
  readonly code: string;
  readonly label: string;
  readonly bankName: string;
  readonly accountNumber?: string | null;
  readonly iban?: string | null;
  readonly currency?: string;
  readonly chartAccountId: string;
  readonly openingBalance?: string;
  readonly status?: BankAccountStatus;
  readonly createdById?: string | null;
}

export interface UpdateBankAccountInput {
  readonly label?: string;
  readonly bankName?: string;
  readonly accountNumber?: string | null;
  readonly iban?: string | null;
  readonly currency?: string;
  readonly chartAccountId?: string;
  readonly openingBalance?: string;
  readonly status?: BankAccountStatus;
  readonly lastReconciledAt?: Date | null;
}

@Injectable()
export class BankAccountsRepository {
  constructor(
    @InjectRepository(BankAccountEntity)
    private readonly repo: Repository<BankAccountEntity>,
  ) {}

  async create(input: CreateBankAccountInput, manager?: EntityManager): Promise<BankAccountEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(BankAccountEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      code: input.code,
      label: input.label,
      bankName: input.bankName,
      accountNumber: input.accountNumber ?? null,
      iban: input.iban ?? null,
      currency: input.currency ?? 'XOF',
      chartAccountId: input.chartAccountId,
      openingBalance: input.openingBalance ?? '0.00',
      status: input.status ?? 'active',
      createdById: input.createdById ?? null,
    });
    return repo.save(entity);
  }

  async findById(id: string, organizationId: TenantId | string): Promise<BankAccountEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findByCode(
    organizationId: TenantId | string,
    code: string,
  ): Promise<BankAccountEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { organizationId, code } });
  }

  async listByOrganization(organizationId: TenantId | string): Promise<BankAccountEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId },
      order: { code: 'ASC' },
    });
  }

  async update(
    id: string,
    organizationId: TenantId | string,
    patch: UpdateBankAccountInput,
    manager?: EntityManager,
  ): Promise<BankAccountEntity> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(BankAccountEntity) : this.repo;
    await repo.update({ id, organizationId }, patch);
    const updated = await repo.findOne({ where: { id, organizationId } });
    if (!updated) {
      throw new Error(`BankAccount ${id} disappeared after UPDATE in org ${organizationId}`);
    }
    return updated;
  }
}
