import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

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
  readonly matchGroupId?: string | null;
  readonly fxRateApplied?: string | null;
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
      matchGroupId: input.matchGroupId ?? null,
      fxRateApplied: input.fxRateApplied ?? null,
    });
    return repo.save(entity);
  }

  async createMany(
    inputs: ReadonlyArray<CreateMatchInput>,
    manager: EntityManager,
  ): Promise<BankReconciliationMatchEntity[]> {
    if (inputs.length === 0) return [];
    inputs.forEach((i) => assertTenantId(i.organizationId));
    const repo = manager.getRepository(BankReconciliationMatchEntity);
    const entities = inputs.map((i) =>
      repo.create({
        organizationId: i.organizationId,
        bankStatementLineId: i.bankStatementLineId,
        journalEntryLineId: i.journalEntryLineId,
        matchMethod: i.matchMethod,
        confidenceScore: i.confidenceScore ?? null,
        matchedById: i.matchedById ?? null,
        matchedAt: new Date(),
        matchGroupId: i.matchGroupId ?? null,
        fxRateApplied: i.fxRateApplied ?? null,
      }),
    );
    return repo.save(entities);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<BankReconciliationMatchEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findByGroup(
    matchGroupId: string,
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<BankReconciliationMatchEntity[]> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(BankReconciliationMatchEntity) : this.repo;
    return repo.find({ where: { matchGroupId, organizationId } });
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

  async deleteMany(
    ids: ReadonlyArray<string>,
    organizationId: TenantId | string,
    manager: EntityManager,
  ): Promise<void> {
    if (ids.length === 0) return;
    assertTenantId(organizationId);
    const repo = manager.getRepository(BankReconciliationMatchEntity);
    await repo.delete({ id: In([...ids]), organizationId });
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
