import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { BankStatementEntity } from '../entities/bank-statement.entity';
import type { BankStatementStatus } from '../types/bank.types';

export interface CreateBankStatementInput {
  readonly organizationId: TenantId | string;
  readonly bankAccountId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly openingBalance: string;
  readonly closingBalance: string;
  readonly currency?: string;
  readonly importedFileName: string;
  readonly importedFileHash: string;
  readonly importedLinesCount: number;
  readonly matchedLinesCount?: number;
  readonly status?: BankStatementStatus;
  readonly importedById?: string | null;
  readonly importedAt?: Date;
}

@Injectable()
export class BankStatementsRepository {
  constructor(
    @InjectRepository(BankStatementEntity)
    private readonly repo: Repository<BankStatementEntity>,
  ) {}

  async create(
    input: CreateBankStatementInput,
    manager?: EntityManager,
  ): Promise<BankStatementEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(BankStatementEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      bankAccountId: input.bankAccountId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      openingBalance: input.openingBalance,
      closingBalance: input.closingBalance,
      currency: input.currency ?? 'XOF',
      importedFileName: input.importedFileName,
      importedFileHash: input.importedFileHash,
      importedLinesCount: input.importedLinesCount,
      matchedLinesCount: input.matchedLinesCount ?? 0,
      status: input.status ?? 'imported',
      importedById: input.importedById ?? null,
      importedAt: input.importedAt ?? new Date(),
    });
    return repo.save(entity);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<BankStatementEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findByHash(
    organizationId: TenantId | string,
    bankAccountId: string,
    fileHash: string,
  ): Promise<BankStatementEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: { organizationId, bankAccountId, importedFileHash: fileHash },
    });
  }

  async listByBankAccount(
    organizationId: TenantId | string,
    bankAccountId: string,
  ): Promise<BankStatementEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, bankAccountId },
      order: { periodEnd: 'DESC' },
    });
  }

  async updateCounts(
    id: string,
    organizationId: TenantId | string,
    matchedCount: number,
    status: BankStatementStatus,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(BankStatementEntity) : this.repo;
    await repo.update({ id, organizationId }, { matchedLinesCount: matchedCount, status });
  }
}
