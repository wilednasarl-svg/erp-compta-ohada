import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { ImportSessionEntity } from '../entities/import-session.entity';
import { ImportStagingEntryEntity } from '../entities/import-staging-entry.entity';
import type { ValidationError } from '../types/import-status';
import type { MappedRow } from '../types/mapping';

/**
 * Tenant-scoped repository for `import_staging_entries`.
 *
 * Comme `ImportFileRepository`, le scope tenant transite par
 * `import_sessions.organization_id`. Toute lecture par `sessionId`
 * fait un JOIN re-vérifiant l'org.
 *
 * Volumétrie : un fichier 50 000 lignes = 50 000 rows. `bulkInsert`
 * accepte un batch en une seule requête INSERT pour rester sous le
 * seuil 1 transaction / N inserts qui ferait exploser le pooler.
 */
@Injectable()
export class ImportStagingEntryRepository {
  constructor(
    @InjectRepository(ImportStagingEntryEntity)
    private readonly repo: Repository<ImportStagingEntryEntity>,
  ) {}

  private scoped(manager?: EntityManager): Repository<ImportStagingEntryEntity> {
    return manager ? manager.getRepository(ImportStagingEntryEntity) : this.repo;
  }

  async bulkInsert(
    rows: ReadonlyArray<{
      sessionId: string;
      fileId: string;
      rowNumber: number;
      rawValues: Record<string, string | null>;
      mappedValues: MappedRow;
      errors: ValidationError[];
    }>,
    manager?: EntityManager,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.scoped(manager)
      .createQueryBuilder()
      .insert()
      .into(ImportStagingEntryEntity)
      .values(rows.map((r) => ({ ...r })))
      .execute();
  }

  async listBySession(
    sessionId: string,
    organizationId: TenantId | string,
    options: { limit?: number; offset?: number; onlyWithErrors?: boolean } = {},
  ): Promise<ImportStagingEntryEntity[]> {
    assertTenantId(organizationId);
    const qb = this.repo
      .createQueryBuilder('e')
      .innerJoin(ImportSessionEntity, 's', 's.id = e.session_id')
      .where('e.session_id = :sessionId', { sessionId })
      .andWhere('s.organization_id = :organizationId', { organizationId })
      .orderBy('e.row_number', 'ASC')
      .take(options.limit ?? 100)
      .skip(options.offset ?? 0);
    if (options.onlyWithErrors === true) {
      // jsonb_array_length > 0 = at least one error finding
      qb.andWhere(`jsonb_array_length(e.errors) > 0`);
    }
    return qb.getMany();
  }

  async countBySession(
    sessionId: string,
    organizationId: TenantId | string,
  ): Promise<{ total: number; withErrors: number }> {
    assertTenantId(organizationId);
    const result = await this.repo
      .createQueryBuilder('e')
      .innerJoin(ImportSessionEntity, 's', 's.id = e.session_id')
      .where('e.session_id = :sessionId', { sessionId })
      .andWhere('s.organization_id = :organizationId', { organizationId })
      .select('COUNT(*)::int', 'total')
      .addSelect('COUNT(*) FILTER (WHERE jsonb_array_length(e.errors) > 0)::int', 'withErrors')
      .getRawOne<{ total: number; withErrors: number }>();
    return {
      total: result?.total ?? 0,
      withErrors: result?.withErrors ?? 0,
    };
  }

  async deleteBySession(
    sessionId: string,
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    // Re-check tenant ownership before the bulk DELETE — `sessionId`
    // alone is not trusted at the repo boundary.
    const sessionRepo = (manager ?? this.repo.manager).getRepository(ImportSessionEntity);
    const session = await sessionRepo.findOne({ where: { id: sessionId, organizationId } });
    if (!session) {
      return;
    }
    await this.scoped(manager).delete({ sessionId });
  }
}
