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
    // We return the actual `next_entry_number` column (not a computed
    // alias) so the returned key matches a real column name — avoids
    // surprises if TypeORM / pg-driver naming behaviour changes for
    // aliased expressions. We then subtract 1 in JS to get the number
    // that becomes the new entry's `entry_number`.
    //
    // Hardened after prod smoke test (commitSession): the previous
    // version aliased the expression `(next_entry_number - 1) AS
    // assigned_number` and used `Number(result[0].assigned_number)`.
    // In prod, that resolved to `undefined` → `NaN` → PG rejected the
    // downstream INSERT with `invalid input syntax for type integer:
    // "NaN"`, making every commitSession fail with IMPORT_COMMIT_FAILED.
    const result: unknown = await manager.query(
      `UPDATE journals
         SET next_entry_number = next_entry_number + 1,
             updated_at = now()
       WHERE id = $1 AND organization_id = $2
       RETURNING next_entry_number`,
      [journalId, organizationId],
    );

    const rows = Array.isArray(result) ? result : [];
    if (rows.length === 0) {
      throw new Error(
        `Journal ${journalId} not found in org ${organizationId} — cannot assign entry number`,
      );
    }
    const row = rows[0];
    // pg / TypeORM return INTEGER columns as JS number, but be defensive
    // (a future driver swap or a schema change to BIGINT would return
    // strings). Accept number or numeric string; refuse anything else
    // loudly so the failure surfaces with the seen shape rather than
    // silently producing NaN.
    const raw = (row as Record<string, unknown>)?.next_entry_number;
    const next =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && /^\d+$/.test(raw)
          ? Number(raw)
          : Number.NaN;
    if (!Number.isFinite(next) || next < 1) {
      throw new Error(
        `assignNextEntryNumber: unexpected RETURNING shape for journal ${journalId} — ` +
          `expected { next_entry_number: number } but got ${JSON.stringify(row)}`,
      );
    }
    // RETURNING gives the value AFTER `+ 1`. The number assigned to the
    // new entry is one less (the value at row read time, before bump).
    return next - 1;
  }
}
