import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { BankReconciliationMatchEntity } from '../entities/bank-reconciliation-match.entity';
import type { BankMatchMethod } from '../types/bank.types';

export interface CreateMatchInput {
  readonly organizationId: TenantId | string;
  readonly bankStatementLineId: string;
  readonly journalEntryLineId: string;
  readonly matchMethod: BankMatchMethod;
  readonly confidenceScore?: number | null;
  readonly matchedById?: string | null;
}

@Injectable()
export class BankReconciliationMatchesRepository {
  constructor(
    @InjectRepository(BankReconciliationMatchEntity)
    private readonly repo: Repository<BankReconciliationMatchEntity>,
  ) {}

  async create(
    input: CreateMatchInput,
    manager?: EntityManager,
  ): Promise<BankReconciliationMatchEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(BankReconciliationMatchEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      bankStatementLineId: input.bankStatementLineId,
      journalEntryLineId: input.journalEntryLineId,
      matchMethod: input.matchMethod,
      confidenceScore: input.confidenceScore ?? null,
      matchedById: input.matchedById ?? null,
      matchedAt: new Date(),
    });
    return repo.save(entity);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<BankReconciliationMatchEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async delete(
    id: string,
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(BankReconciliationMatchEntity) : this.repo;
    await repo.delete({ id, organizationId });
  }

  async countByStatementLine(
    statementLineId: string,
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<number> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(BankReconciliationMatchEntity) : this.repo;
    return repo.count({ where: { bankStatementLineId: statementLineId, organizationId } });
  }
}
