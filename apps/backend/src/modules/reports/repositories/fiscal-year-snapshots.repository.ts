import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import {
  FiscalYearSnapshotEntity,
  type FiscalYearSnapshotType,
} from '../entities/fiscal-year-snapshot.entity';

export interface UpsertSnapshotInput {
  readonly organizationId: TenantId | string;
  readonly exerciseId: string;
  readonly snapshotType: FiscalYearSnapshotType;
  readonly payload: Record<string, unknown>;
  readonly takenById: string | null;
}

/**
 * `FiscalYearSnapshotsRepository` — accès à la table
 * `fiscal_year_snapshots` (W5.5). Toutes les méthodes scopent sur
 * `organizationId` via `assertTenantId`. Append-only.
 */
@Injectable()
export class FiscalYearSnapshotsRepository {
  constructor(
    @InjectRepository(FiscalYearSnapshotEntity)
    private readonly repo: Repository<FiscalYearSnapshotEntity>,
  ) {}

  /**
   * Snapshot ACTIF pour un exercice + type (NULL si jamais fixé). Le
   * snapshot actif est celui dont `superseded_at IS NULL`. L'index
   * unique partiel garantit qu'il n'y en a qu'un.
   */
  async getActive(
    organizationId: TenantId | string,
    exerciseId: string,
    snapshotType: FiscalYearSnapshotType,
  ): Promise<FiscalYearSnapshotEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: { organizationId, exerciseId, snapshotType, supersededAt: IsNull() },
    });
  }

  /**
   * Historique complet (le plus récent en premier) pour audit.
   */
  async listHistory(
    organizationId: TenantId | string,
    exerciseId: string,
    snapshotType: FiscalYearSnapshotType,
  ): Promise<ReadonlyArray<FiscalYearSnapshotEntity>> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, exerciseId, snapshotType },
      order: { takenAt: 'DESC' },
    });
  }

  /**
   * Pose un nouveau snapshot. Si un snapshot actif existe pour le même
   * (org, exercise, type), il est marqué `superseded_at = now()` AVANT
   * l'INSERT pour respecter l'index partiel unique. L'opération est
   * transactionnelle via un `transaction` TypeORM (Postgres COMMIT
   * atomique sur les deux UPDATEs).
   */
  async upsertActive(input: UpsertSnapshotInput): Promise<FiscalYearSnapshotEntity> {
    assertTenantId(input.organizationId);
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(FiscalYearSnapshotEntity);

      const current = await repo.findOne({
        where: {
          organizationId: input.organizationId,
          exerciseId: input.exerciseId,
          snapshotType: input.snapshotType,
          supersededAt: IsNull(),
        },
      });
      if (current) {
        current.supersededAt = new Date();
        await repo.save(current);
      }

      const inserted = repo.create({
        organizationId: input.organizationId,
        exerciseId: input.exerciseId,
        snapshotType: input.snapshotType,
        payload: input.payload,
        takenById: input.takenById,
        supersededAt: null,
      });
      return repo.save(inserted);
    });
  }
}
