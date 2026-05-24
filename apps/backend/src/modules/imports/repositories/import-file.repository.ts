import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { ImportFileEntity } from '../entities/import-file.entity';
import { ImportSessionEntity } from '../entities/import-session.entity';
import type { ImportFileStatus } from '../types/import-status';

/**
 * Tenant-scoped repository for `import_files`.
 *
 * `import_files` itself has no `organization_id` column (the tenant is
 * derived from `session_id → import_sessions.organization_id`). Every
 * query that reads or writes by `id` therefore JOINs back through
 * `import_sessions` and re-checks `organization_id`, so a leaked
 * `fileId` from another tenant cannot bypass scope.
 */
@Injectable()
export class ImportFileRepository {
  constructor(
    @InjectRepository(ImportFileEntity)
    private readonly repo: Repository<ImportFileEntity>,
  ) {}

  private scoped(manager?: EntityManager): Repository<ImportFileEntity> {
    return manager ? manager.getRepository(ImportFileEntity) : this.repo;
  }

  async create(
    input: {
      sessionId: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      sha256Checksum: string;
      storagePath: string;
      uploadedById: string;
    },
    manager?: EntityManager,
  ): Promise<ImportFileEntity> {
    const repo = this.scoped(manager);
    const entity = repo.create({
      sessionId: input.sessionId,
      originalName: input.originalName,
      mimeType: input.mimeType,
      // BIGINT is mapped to string by TypeORM's pg driver to preserve
      // precision beyond 2^53. We accept `number` (file sizes well
      // under 2 GB in practice) and stringify on the boundary.
      sizeBytes: String(input.sizeBytes),
      sha256Checksum: input.sha256Checksum,
      storagePath: input.storagePath,
      uploadedById: input.uploadedById,
      status: 'uploaded',
    });
    return repo.save(entity);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<ImportFileEntity | null> {
    assertTenantId(organizationId);
    return this.scoped(manager)
      .createQueryBuilder('f')
      .innerJoin(ImportSessionEntity, 's', 's.id = f.session_id')
      .where('f.id = :id', { id })
      .andWhere('s.organization_id = :organizationId', { organizationId })
      .getOne();
  }

  async listBySession(
    sessionId: string,
    organizationId: TenantId | string,
  ): Promise<ImportFileEntity[]> {
    assertTenantId(organizationId);
    return this.repo
      .createQueryBuilder('f')
      .innerJoin(ImportSessionEntity, 's', 's.id = f.session_id')
      .where('f.session_id = :sessionId', { sessionId })
      .andWhere('s.organization_id = :organizationId', { organizationId })
      .orderBy('f.uploaded_at', 'ASC')
      .getMany();
  }

  /**
   * Doublon exact = même checksum dans la même session. Pas de scope
   * cross-session (deux sessions peuvent légitimement référencer le
   * même fichier).
   */
  async findByChecksumInSession(
    sessionId: string,
    sha256Checksum: string,
    organizationId: TenantId | string,
  ): Promise<ImportFileEntity | null> {
    assertTenantId(organizationId);
    return this.repo
      .createQueryBuilder('f')
      .innerJoin(ImportSessionEntity, 's', 's.id = f.session_id')
      .where('f.session_id = :sessionId', { sessionId })
      .andWhere('f.sha256_checksum = :sha256Checksum', { sha256Checksum })
      .andWhere('s.organization_id = :organizationId', { organizationId })
      .getOne();
  }

  async updateStatus(
    id: string,
    organizationId: TenantId | string,
    status: ImportFileStatus,
    parseError: string | null = null,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    // Re-check tenant scope before the UPDATE — `id` alone would let
    // an attacker mutate another tenant's row if they obtained the
    // UUID. We resolve to the session inside the same transaction to
    // confirm ownership.
    const file = await this.findById(id, organizationId, manager);
    if (!file) {
      return;
    }
    await this.scoped(manager).update({ id }, { status, parseError });
  }
}
