import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { BankStatementLineEntity } from '../entities/bank-statement-line.entity';
import type { BankStatementLineMatchStatus } from '../types/bank.types';

export interface CreateBankStatementLineInput {
  readonly organizationId: TenantId | string;
  readonly bankStatementId: string;
  readonly bankAccountId: string;
  readonly lineOrder: number;
  readonly operationDate: string;
  readonly valueDate?: string | null;
  readonly label: string;
  readonly bankReference?: string | null;
  readonly amount: string;
  readonly matchStatus?: BankStatementLineMatchStatus;
}

@Injectable()
export class BankStatementLinesRepository {
  constructor(
    @InjectRepository(BankStatementLineEntity)
    private readonly repo: Repository<BankStatementLineEntity>,
  ) {}

  async createMany(
    inputs: ReadonlyArray<CreateBankStatementLineInput>,
    manager?: EntityManager,
  ): Promise<BankStatementLineEntity[]> {
    if (inputs.length === 0) return [];
    inputs.forEach((i) => assertTenantId(i.organizationId));
    const repo = manager ? manager.getRepository(BankStatementLineEntity) : this.repo;
    const entities = inputs.map((i) =>
      repo.create({
        organizationId: i.organizationId,
        bankStatementId: i.bankStatementId,
        bankAccountId: i.bankAccountId,
        lineOrder: i.lineOrder,
        operationDate: i.operationDate,
        valueDate: i.valueDate ?? null,
        label: i.label,
        bankReference: i.bankReference ?? null,
        amount: i.amount,
        matchStatus: i.matchStatus ?? 'unmatched',
      }),
    );
    return repo.save(entities);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<BankStatementLineEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async listByStatement(
    statementId: string,
    organizationId: TenantId | string,
  ): Promise<BankStatementLineEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { bankStatementId: statementId, organizationId },
      order: { lineOrder: 'ASC' },
    });
  }

  async listUnmatchedByAccount(
    bankAccountId: string,
    organizationId: TenantId | string,
  ): Promise<BankStatementLineEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { bankAccountId, organizationId, matchStatus: 'unmatched' },
      order: { operationDate: 'ASC', lineOrder: 'ASC' },
    });
  }

  async updateStatus(
    id: string,
    organizationId: TenantId | string,
    status: BankStatementLineMatchStatus,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(BankStatementLineEntity) : this.repo;
    await repo.update({ id, organizationId }, { matchStatus: status });
  }

  async countMatchedByStatement(
    statementId: string,
    organizationId: TenantId | string,
  ): Promise<number> {
    assertTenantId(organizationId);
    return this.repo.count({
      where: { bankStatementId: statementId, organizationId, matchStatus: 'matched' },
    });
  }
}
