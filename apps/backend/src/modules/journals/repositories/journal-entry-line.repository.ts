import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { JournalEntryLineEntity } from '../entities/journal-entry-line.entity';

export interface CreateLineInput {
  readonly organizationId: TenantId | string;
  readonly journalEntryId: string;
  readonly accountId: string;
  readonly position: number;
  readonly description?: string | null;
  readonly debit: string;
  readonly credit: string;
}

@Injectable()
export class JournalEntryLineRepository {
  constructor(
    @InjectRepository(JournalEntryLineEntity)
    private readonly repo: Repository<JournalEntryLineEntity>,
  ) {}

  async createMany(
    lines: CreateLineInput[],
    manager?: EntityManager,
  ): Promise<JournalEntryLineEntity[]> {
    if (lines.length === 0) return [];
    const repo = manager ? manager.getRepository(JournalEntryLineEntity) : this.repo;
    const entities = repo.create(
      lines.map((l) => ({
        organizationId: l.organizationId,
        journalEntryId: l.journalEntryId,
        accountId: l.accountId,
        position: l.position,
        description: l.description ?? null,
        debit: l.debit,
        credit: l.credit,
        lineLetter: null,
      })),
    );
    return repo.save(entities);
  }

  async listByEntry(entryId: string): Promise<JournalEntryLineEntity[]> {
    return this.repo.find({
      where: { journalEntryId: entryId },
      order: { position: 'ASC' },
    });
  }

  async listByAccountAndOrg(
    organizationId: TenantId | string,
    accountId: string,
  ): Promise<JournalEntryLineEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, accountId },
      order: { createdAt: 'DESC' },
    });
  }
}
