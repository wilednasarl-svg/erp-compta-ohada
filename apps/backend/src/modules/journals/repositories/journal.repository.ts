import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { JournalEntity } from '../entities/journal.entity';
import type { JournalKind } from '../types/journal.types';

export interface CreateJournalInput {
  readonly organizationId: TenantId | string;
  readonly code: string;
  readonly label: string;
  readonly kind: JournalKind;
  readonly defaultAccountId?: string | null;
}

@Injectable()
export class JournalRepository {
  constructor(
    @InjectRepository(JournalEntity)
    private readonly repo: Repository<JournalEntity>,
  ) {}

  async create(input: CreateJournalInput, manager?: EntityManager): Promise<JournalEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(JournalEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      code: input.code,
      label: input.label,
      kind: input.kind,
      defaultAccountId: input.defaultAccountId ?? null,
      nextEntryNumber: 1,
      isActive: true,
    });
    return repo.save(entity);
  }

  async findById(id: string, organizationId: TenantId | string): Promise<JournalEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findByCode(organizationId: TenantId | string, code: string): Promise<JournalEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { organizationId, code } });
  }

  async listByOrganization(
    organizationId: TenantId | string,
    options: { activeOnly?: boolean } = {},
  ): Promise<JournalEntity[]> {
    assertTenantId(organizationId);
    const where = options.activeOnly ? { organizationId, isActive: true } : { organizationId };
    return this.repo.find({ where, order: { code: 'ASC' } });
  }

  /**
   * Incrémente atomiquement `next_entry_number` et retourne l'ancien
   * numéro (qui devient `entry_number` de la nouvelle écriture).
   *
   * MUST run inside a transaction — la mise à jour + le SELECT du compteur
   * + l'INSERT de la `journal_entries` sont indivisibles.
   */
  async assignNextEntryNumber(
    journalId: string,
    organizationId: TenantId | string,
    manager: EntityManager,
  ): Promise<number> {
    assertTenantId(organizationId);
    const result: Array<{ assigned_number: number }> = await manager.query(
      `UPDATE journals
         SET next_entry_number = next_entry_number + 1,
             updated_at = now()
       WHERE id = $1 AND organization_id = $2
       RETURNING (next_entry_number - 1) AS assigned_number`,
      [journalId, organizationId],
    );
    if (result.length === 0) {
      throw new Error(
        `Journal ${journalId} not found in org ${organizationId} — cannot assign entry number`,
      );
    }
    return Number(result[0].assigned_number);
  }
}
