import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import type { CreatePledgedAssetDto } from '../dto/create-pledged-asset.dto';
import type { UpdatePledgedAssetDto } from '../dto/update-pledged-asset.dto';
import { PledgedAssetEntity } from '../entities/pledged-asset.entity';
import {
  PledgedAssetsRepository,
  type ListPledgedAssetsFilters,
} from '../repositories/pledged-assets.repository';
import {
  PLEDGE_TYPE_LABELS,
  type PledgedAssetSnapshot,
  type PledgeType,
} from '../types/pledged-asset.types';

const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * E1 — Service applicatif des sûretés réelles données.
 *
 * Responsabilités :
 *   - création / mise à jour / main-levée / annulation
 *   - listing tenant-scope avec filtres status / pledgeType
 *   - exposition d'un `listActiveAsOf` consommé par les handlers de
 *     notes annexes N1 (dettes garanties) et N16Bbis (actifs nantis).
 *
 * Pas de pose d'écriture comptable dans cette wave : une sûreté est un
 * engagement hors bilan ; elle n'a pas d'impact débit/crédit.
 */
@Injectable()
export class PledgedAssetsService {
  private readonly logger = new Logger(PledgedAssetsService.name);

  constructor(private readonly repo: PledgedAssetsRepository) {}

  // ─── Queries ────────────────────────────────────────────────────────

  async findById(organizationId: TenantId | string, id: string): Promise<PledgedAssetEntity> {
    assertTenantId(organizationId);
    return this.requirePledgedAsset(organizationId, id);
  }

  async listByOrg(
    organizationId: TenantId | string,
    filters: ListPledgedAssetsFilters = {},
  ): Promise<ReadonlyArray<PledgedAssetEntity>> {
    assertTenantId(organizationId);
    return this.repo.listByOrganization(organizationId, filters);
  }

  /**
   * Sûretés actives à `asAtDate`, projetées en `PledgedAssetSnapshot`
   * (DTO découplé des entités TypeORM) — consommé par les handlers
   * de notes annexes.
   */
  async listActiveAsOf(
    organizationId: TenantId | string,
    asAtDate: string,
  ): Promise<ReadonlyArray<PledgedAssetSnapshot>> {
    assertTenantId(organizationId);
    this.assertIsoDate(asAtDate, 'asAtDate');
    const rows = await this.repo.listActiveAsOf(organizationId, asAtDate);
    return rows.map((r) => this.toSnapshot(r));
  }

  // ─── Mutations ──────────────────────────────────────────────────────

  async create(
    organizationId: TenantId | string,
    dto: CreatePledgedAssetDto,
    createdBy: string | null,
  ): Promise<PledgedAssetEntity> {
    assertTenantId(organizationId);
    this.assertPositiveAmount(dto.brutAmount, 'brutAmount');
    this.assertIsoDate(dto.startDate, 'startDate');
    if (dto.endDate !== null && dto.endDate !== undefined) {
      this.assertIsoDate(dto.endDate, 'endDate');
      this.assertDateRange(dto.startDate, dto.endDate);
    }

    const entity = await this.repo.create({
      organizationId,
      liabilityAccountCode: dto.liabilityAccountCode,
      liabilityLabel: dto.liabilityLabel,
      brutAmount: this.normalizeAmount(dto.brutAmount),
      pledgeType: dto.pledgeType,
      assetReference: dto.assetReference,
      assetLocation: dto.assetLocation ?? null,
      creditorName: dto.creditorName,
      startDate: dto.startDate,
      endDate: dto.endDate ?? null,
      comment: dto.comment ?? null,
      createdById: createdBy,
    });

    this.logger.log(
      `PledgedAsset ${entity.id} created — ${dto.pledgeType} on ${dto.assetReference} ` +
        `for liability ${dto.liabilityLabel} (${dto.brutAmount})`,
    );
    return entity;
  }

  async update(
    organizationId: TenantId | string,
    id: string,
    dto: UpdatePledgedAssetDto,
  ): Promise<PledgedAssetEntity> {
    assertTenantId(organizationId);
    const existing = await this.requirePledgedAsset(organizationId, id);
    this.assertActive(existing);

    if (dto.brutAmount !== undefined) {
      this.assertPositiveAmount(dto.brutAmount, 'brutAmount');
    }
    if (dto.startDate !== undefined) {
      this.assertIsoDate(dto.startDate, 'startDate');
    }
    if (dto.endDate !== undefined && dto.endDate !== null) {
      this.assertIsoDate(dto.endDate, 'endDate');
    }

    const nextStart = dto.startDate ?? existing.startDate;
    const nextEnd = dto.endDate === undefined ? existing.endDate : dto.endDate;
    if (nextEnd !== null) {
      this.assertDateRange(nextStart, nextEnd);
    }

    const patch = {
      ...(dto.liabilityAccountCode !== undefined && {
        liabilityAccountCode: dto.liabilityAccountCode,
      }),
      ...(dto.liabilityLabel !== undefined && { liabilityLabel: dto.liabilityLabel }),
      ...(dto.brutAmount !== undefined && {
        brutAmount: this.normalizeAmount(dto.brutAmount),
      }),
      ...(dto.pledgeType !== undefined && { pledgeType: dto.pledgeType }),
      ...(dto.assetReference !== undefined && { assetReference: dto.assetReference }),
      ...(dto.assetLocation !== undefined && { assetLocation: dto.assetLocation }),
      ...(dto.creditorName !== undefined && { creditorName: dto.creditorName }),
      ...(dto.startDate !== undefined && { startDate: dto.startDate }),
      ...(dto.endDate !== undefined && { endDate: dto.endDate }),
      ...(dto.comment !== undefined && { comment: dto.comment }),
    };

    return this.repo.update(organizationId, id, patch);
  }

  /**
   * Main-levée : passe la sûreté en statut `released` avec date.
   * Refusée si la sûreté n'est pas active.
   */
  async release(
    organizationId: TenantId | string,
    id: string,
    releaseDate: string,
    _releasedBy: string | null,
  ): Promise<PledgedAssetEntity> {
    assertTenantId(organizationId);
    this.assertIsoDate(releaseDate, 'releaseDate');
    const existing = await this.requirePledgedAsset(organizationId, id);
    this.assertActive(existing);
    this.assertDateRange(existing.startDate, releaseDate);

    return this.repo.update(organizationId, id, {
      status: 'released',
      endDate: releaseDate,
      releasedAt: new Date(),
    });
  }

  /** Annulation administrative — possible uniquement sur sûretés actives. */
  async cancel(organizationId: TenantId | string, id: string): Promise<PledgedAssetEntity> {
    assertTenantId(organizationId);
    const existing = await this.requirePledgedAsset(organizationId, id);
    this.assertActive(existing);

    return this.repo.update(organizationId, id, {
      status: 'cancelled',
      releasedAt: new Date(),
    });
  }

  // ─── Internal helpers ───────────────────────────────────────────────

  private async requirePledgedAsset(
    organizationId: TenantId | string,
    id: string,
  ): Promise<PledgedAssetEntity> {
    const found = await this.repo.findById(organizationId, id);
    if (!found) {
      throw new AppException(ERROR_CODES.PLEDGED_ASSET_NOT_FOUND, {
        message: `PledgedAsset '${id}' not found in this organization.`,
      });
    }
    return found;
  }

  private assertActive(entity: PledgedAssetEntity): void {
    if (entity.status !== 'active') {
      throw new AppException(ERROR_CODES.PLEDGED_ASSET_NOT_ACTIVE, {
        message: `PledgedAsset '${entity.id}' is not active (status=${entity.status}).`,
      });
    }
  }

  private assertPositiveAmount(amount: string, field: string): void {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      throw new AppException(ERROR_CODES.PLEDGED_ASSET_INVALID_DATE_RANGE, {
        message: `${field} must be a positive number, got '${amount}'.`,
      });
    }
  }

  private assertIsoDate(value: string, field: string): void {
    if (!DATE_ISO_RE.test(value)) {
      throw new AppException(ERROR_CODES.PLEDGED_ASSET_INVALID_DATE_RANGE, {
        message: `${field} must be a valid ISO date YYYY-MM-DD, got '${value}'.`,
      });
    }
  }

  private assertDateRange(startDate: string, endDate: string): void {
    if (endDate < startDate) {
      throw new AppException(ERROR_CODES.PLEDGED_ASSET_INVALID_DATE_RANGE, {
        message: `endDate (${endDate}) must be >= startDate (${startDate}).`,
      });
    }
  }

  private normalizeAmount(amount: string): string {
    return Number(amount).toFixed(2);
  }

  private toSnapshot(entity: PledgedAssetEntity): PledgedAssetSnapshot {
    const pledgeType: PledgeType = entity.pledgeType;
    return {
      id: entity.id,
      liabilityAccountCode: entity.liabilityAccountCode,
      liabilityLabel: entity.liabilityLabel,
      brutAmount: entity.brutAmount,
      pledgeType,
      pledgeTypeLabel: PLEDGE_TYPE_LABELS[pledgeType],
      assetReference: entity.assetReference,
      assetLocation: entity.assetLocation,
      creditorName: entity.creditorName,
      startDate: entity.startDate,
      endDate: entity.endDate,
      status: entity.status,
      comment: entity.comment,
    };
  }
}
