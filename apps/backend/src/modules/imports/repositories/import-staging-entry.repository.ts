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

  /**
   * Bulk-insert staging rows for a parsed file. `organizationId` is
   * required and validated — the rows go in via INSERT … SELECT FROM
   * import_files JOIN import_sessions so that any `sessionId` /
   * `fileId` belonging to a different tenant becomes a zero-row insert
   * (the JOIN drops the rows the caller has no claim to). Defense
   * against a future caller passing a mismatched `sessionId` —
   * documented gap in the original audit Code-H3.
   */
  async bulkInsert(
    organizationId: TenantId | string,
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
    assertTenantId(organizationId);
    if (rows.length === 0) {
      return;
    }
    // We can't easily use INSERT…SELECT JOIN here because the rows are
    // not in the DB yet. Instead: re-verify each session's org match
    // once (cheap — a single SELECT), then bulk insert. The verify
    // is the choke point an attacker would have to bypass.
    const sessionIds = Array.from(new Set(rows.map((r) => r.sessionId)));
    const sessionsRepo = manager
      ? manager.getRepository('import_sessions')
      : this.repo.manager.getRepository('import_sessions');
    const ownedSessions: Array<{ id: string }> = await sessionsRepo
      .createQueryBuilder('s')
      .select('s.id', 'id')
      .where('s.id IN (:...sessionIds)', { sessionIds })
      .andWhere('s.organization_id = :organizationId', { organizationId })
      .getRawMany();
    if (ownedSessions.length !== sessionIds.length) {
      // At least one sessionId in the batch does not belong to this
      // tenant. Refuse the whole batch — failing closed is correct.
      throw new Error(
        `ImportStagingEntryRepository.bulkInsert: ${sessionIds.length - ownedSessions.length} session id(s) do not belong to org ${organizationId}`,
      );
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
    // NOTE: `.orderBy()` resolves entity *property* names (camelCase)
    // via TypeORM metadata, pas le nom DB. Passer `e.row_number`
    // crash avec "Cannot read properties of undefined (reading
    // 'databaseName')" car aucune propriété ne s'appelle row_number.
    // Utiliser `e.rowNumber` — TypeORM produit la bonne colonne
    // snake_case dans le SQL final.
    const qb = this.repo
      .createQueryBuilder('e')
      .innerJoin(ImportSessionEntity, 's', 's.id = e.session_id')
      .where('e.session_id = :sessionId', { sessionId })
      .andWhere('s.organization_id = :organizationId', { organizationId })
      .orderBy('e.rowNumber', 'ASC')
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

  /**
   * Persist the `mappedValues` and `errors` computed by the validation
   * pass back to the staging row. Called by `preview()` after mapping +
   * validation so subsequent SQL counts (`withErrors`) are accurate.
   *
   * Fix projet-ferme-7kn: the previous code computed error counts from
   * the paginated `entries` array only (max 100 rows), leading to an
   * under-reported `errorLines` counter in the session.
   */
  async updateMappedValuesAndErrors(
    entries: ReadonlyArray<{
      id: string;
      mappedValues: MappedRow;
      errors: ValidationError[];
    }>,
    manager?: EntityManager,
  ): Promise<void> {
    if (entries.length === 0) return;
    const repo = this.scoped(manager);
    // Use individual updates — the batch size is small (page size, max ~200).
    // A single bulk UPDATE via VALUES would be faster but TypeORM doesn't
    // expose a clean API for JSONB multi-row UPDATE FROM VALUES.
    await Promise.all(
      entries.map((entry) =>
        repo.update({ id: entry.id }, { mappedValues: entry.mappedValues, errors: entry.errors }),
      ),
    );
  }
}
