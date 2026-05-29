import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { JournalEntryLineEntity } from '../entities/journal-entry-line.entity';
import { JournalEntryEntity } from '../entities/journal-entry.entity';

export interface CreateLineInput {
  readonly organizationId: TenantId | string;
  readonly journalEntryId: string;
  readonly accountId: string;
  readonly position: number;
  readonly description?: string | null;
  readonly debit: string;
  readonly credit: string;
  readonly analyticAxisType?: string | null;
  readonly analyticAxisCode?: string | null;
  /** Métadonnées de pièce (Migration 0110). */
  readonly invoiceNumber?: string | null;
  readonly dueDate?: string | null;
  readonly taxCode?: string | null;
  readonly reference?: string | null;
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
        analyticAxisType: l.analyticAxisType ?? null,
        analyticAxisCode: l.analyticAxisCode ?? null,
        invoiceNumber: l.invoiceNumber ?? null,
        dueDate: l.dueDate ?? null,
        taxCode: l.taxCode ?? null,
        reference: l.reference ?? null,
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

  /**
   * Lettering helper: load all `journal_entry_lines` matching the given
   * IDs IN this tenant, joining the parent entry so the caller can
   * filter on `journal_entries.status` (a draft line must never be
   * lettered — only validated ones). Returns lines in the same order
   * the IDs were requested where possible.
   */
  async listForLetteringCheck(
    organizationId: TenantId | string,
    ids: readonly string[],
  ): Promise<
    Array<{
      line: JournalEntryLineEntity;
      entryStatus: string;
    }>
  > {
    assertTenantId(organizationId);
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.repo
      .createQueryBuilder('l')
      .innerJoinAndMapOne('l.journalEntry', JournalEntryEntity, 'e', 'e.id = l.journal_entry_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere('l.id IN (:...ids)', { ids: [...ids] })
      .getMany();
    return rows.map((line) => ({
      line,
      entryStatus: line.journalEntry?.status ?? 'unknown',
    }));
  }

  async attachLettering(
    lineIds: readonly string[],
    letteringId: string,
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    if (lineIds.length === 0) return;
    const repo = manager ? manager.getRepository(JournalEntryLineEntity) : this.repo;
    await repo.update(
      { id: In([...lineIds]), organizationId, letteringId: IsNull() },
      { letteringId },
    );
  }

  async detachLettering(
    letteringId: string,
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<number> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(JournalEntryLineEntity) : this.repo;
    const result = await repo.update({ letteringId, organizationId }, { letteringId: null });
    return result.affected ?? 0;
  }
}
