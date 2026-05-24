import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { JournalEntryEntity, type JournalEntrySourceType } from '../entities/journal-entry.entity';
import type { JournalEntryStatus } from '../types/journal.types';

export interface CreateEntryInput {
  readonly organizationId: TenantId | string;
  readonly journalId: string;
  readonly periodId: string;
  readonly entryNumber: number;
  readonly entryDate: string;
  readonly description: string;
  readonly reference?: string | null;
  readonly status: JournalEntryStatus;
  readonly sourceType: JournalEntrySourceType;
  readonly sourceImportSessionId?: string | null;
  readonly createdById: string;
  readonly cancelsId?: string | null;
}

export interface ListEntriesFilters {
  readonly status?: JournalEntryStatus;
  readonly journalId?: string;
  readonly periodId?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

@Injectable()
export class JournalEntryRepository {
  constructor(
    @InjectRepository(JournalEntryEntity)
    private readonly repo: Repository<JournalEntryEntity>,
  ) {}

  async create(input: CreateEntryInput, manager?: EntityManager): Promise<JournalEntryEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(JournalEntryEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      journalId: input.journalId,
      periodId: input.periodId,
      entryNumber: input.entryNumber,
      entryDate: input.entryDate,
      description: input.description,
      reference: input.reference ?? null,
      status: input.status,
      sourceType: input.sourceType,
      sourceImportSessionId: input.sourceImportSessionId ?? null,
      createdById: input.createdById,
      cancelsId: input.cancelsId ?? null,
    });
    return repo.save(entity);
  }

  async findById(id: string, organizationId: TenantId | string): Promise<JournalEntryEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId }, relations: ['lines'] });
  }

  async listForOrg(
    organizationId: TenantId | string,
    filters: ListEntriesFilters = {},
  ): Promise<{ entries: JournalEntryEntity[]; total: number }> {
    assertTenantId(organizationId);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;

    const qb = this.repo
      .createQueryBuilder('e')
      .where('e.organization_id = :organizationId', { organizationId });

    if (filters.status) qb.andWhere('e.status = :status', { status: filters.status });
    if (filters.journalId) qb.andWhere('e.journal_id = :journalId', { journalId: filters.journalId });
    if (filters.periodId) qb.andWhere('e.period_id = :periodId', { periodId: filters.periodId });

    qb.orderBy('e.entry_date', 'DESC').addOrderBy('e.entry_number', 'DESC');
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [entries, total] = await qb.getManyAndCount();
    return { entries, total };
  }

  async countDraftsByPeriod(organizationId: TenantId | string, periodId: string): Promise<number> {
    assertTenantId(organizationId);
    return this.repo.count({ where: { organizationId, periodId, status: 'draft' } });
  }

  async updateStatus(
    id: string,
    status: JournalEntryStatus,
    meta: Partial<Pick<JournalEntryEntity, 'validatedAt' | 'validatedById' | 'cancelledAt' | 'cancelledById' | 'cancelledReason'>>,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(JournalEntryEntity) : this.repo;
    await repo.update({ id }, { status, ...meta });
  }
}
