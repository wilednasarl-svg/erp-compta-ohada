import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import { AuditTrailService } from '../../audit/services/audit-trail.service';
import { OrganizationAccountRepository } from '../../accounting-plan/repositories/organization-account.repository';
import { AssetsRepository } from '../../assets/repositories/assets.repository';
import { DepreciationSchedulesRepository } from '../../assets/repositories/depreciation-schedules.repository';
import { InventoryItemRepository } from '../../inventory/repositories/inventory-item.repository';
import {
  EntriesService,
  type CreateLineInput,
} from '../../journals/services/entries.service';
import { TestAssetImpairmentDto } from '../dto/test-asset-impairment.dto';
import { TestInventoryImpairmentDto } from '../dto/test-inventory-impairment.dto';
import { AssetImpairmentEntity } from '../entities/asset-impairment.entity';
import { InventoryImpairmentEntity } from '../entities/inventory-impairment.entity';
import { AssetImpairmentsRepository } from '../repositories/asset-impairments.repository';
import { InventoryImpairmentsRepository } from '../repositories/inventory-impairments.repository';
import {
  ASSET_IMPAIRMENT_EXPENSE_ACCOUNT,
  ASSET_IMPAIRMENT_REVERSAL_ACCOUNT,
  INVENTORY_IMPAIRMENT_EXPENSE_ACCOUNT,
  INVENTORY_IMPAIRMENT_REVERSAL_ACCOUNT,
  depreciationContraAccountFor,
  inventoryContraAccountFor,
  type ImpairmentType,
} from '../types/impairment.types';

/**
 * Tolérance de comparaison décimale (2 décimales fixées dans les
 * NUMERIC(15,2)). Évite les faux positifs sur les arrondis float.
 */
const EPSILON = 0.005;

const OD_JOURNAL_CODE = 'OD';

@Injectable()
export class ImpairmentsService {
  private static readonly MODULE = 'impairments' as const;
  private readonly logger = new Logger(ImpairmentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly assetImpairmentsRepo: AssetImpairmentsRepository,
    private readonly inventoryImpairmentsRepo: InventoryImpairmentsRepository,
    private readonly assetsRepo: AssetsRepository,
    private readonly schedulesRepo: DepreciationSchedulesRepository,
    private readonly inventoryItemsRepo: InventoryItemRepository,
    private readonly accountsRepo: OrganizationAccountRepository,
    private readonly entriesService: EntriesService,
    private readonly audit: AuditTrailService,
  ) {}

  // ─── Asset impairment ──────────────────────────────────────────────

  /**
   * Run an impairment test on a fixed asset.
   *
   * Flow:
   *   1. Resolve the asset (404 if cross-tenant or missing).
   *   2. Compute the VNC (Net Book Value) at `testDate` from the
   *      schedule: pick the latest schedule line whose periodEnd ≤
   *      testDate. Fallback to acquisitionCost − residualValue if no
   *      line applies (asset still in pre-service window).
   *   3. Compare carrying vs recoverable :
   *        - carrying > recoverable + EPS → depreciation
   *        - carrying < recoverable − EPS AND prior net imp. > 0 → reprise
   *        - else → no-op impairment row (amount=0, type='depreciation')
   *   4. For depreciation : post D 6917 / C 29x (29x depends on the
   *      asset's classe via assetAccountCode mapping).
   *   5. For reprise : plafonner à la somme nette des dépréciations
   *      antérieures (App. 44). Post D 29x / C 7917.
   *
   * Garde-fou : si reprise demandée > cumul net déprécié → 422
   * `IMPAIRMENT_REPRISE_EXCEEDS_HISTORY`.
   */
  async testAssetImpairment(
    organizationId: TenantId,
    dto: TestAssetImpairmentDto,
    actorId: string,
    ctx: AuditContext,
  ): Promise<AssetImpairmentEntity> {
    assertTenantId(organizationId);

    const asset = await this.assetsRepo.findById(dto.assetId, organizationId);
    if (!asset) {
      throw new AppException(ERROR_CODES.IMPAIRMENT_ASSET_NOT_FOUND, {
        message: `Asset '${dto.assetId}' not found in this organization.`,
      });
    }

    const recoverable = this.parseAmount(
      dto.recoverableAmount,
      'recoverableAmount',
    );
    const carrying = await this.computeAssetCarryingAmount(
      dto.assetId,
      organizationId,
      dto.testDate,
      asset.acquisitionCost,
      asset.residualValue,
    );

    if (carrying < -EPSILON) {
      throw new AppException(ERROR_CODES.IMPAIRMENT_INVALID_AMOUNT, {
        message: `Computed carrying amount is negative (${carrying}).`,
      });
    }

    // Net cumul des dépréciations passées (App. 44).
    const priorNetImpairment = await this.assetImpairmentsRepo.sumNetImpairmentsForAsset(
      dto.assetId,
      organizationId,
    );

    const diff = carrying - recoverable;
    let type: ImpairmentType;
    let impairmentAmount: number;

    if (diff > EPSILON) {
      // Nouvelle dépréciation : VNC > VA.
      type = 'depreciation';
      impairmentAmount = this.round2(diff);
    } else if (diff < -EPSILON && priorNetImpairment > EPSILON) {
      // Reprise possible : la valeur remonte ET on a déjà déprécié.
      type = 'reprise';
      const wantedReprise = this.round2(-diff);
      if (wantedReprise > priorNetImpairment + EPSILON) {
        throw new AppException(ERROR_CODES.IMPAIRMENT_REPRISE_EXCEEDS_HISTORY, {
          message: `Reprise ${wantedReprise} exceeds cumulated impairments (${priorNetImpairment.toFixed(2)}).`,
          details: { wantedReprise, priorNetImpairment },
        });
      }
      impairmentAmount = wantedReprise;
    } else {
      // Aucun mouvement comptable nécessaire — on enregistre quand même
      // un test "neutre" pour traçabilité (auditeur, dossier permanent).
      return this.assetImpairmentsRepo.create({
        organizationId,
        assetId: dto.assetId,
        testDate: dto.testDate,
        carryingAmount: carrying.toFixed(2),
        recoverableAmount: recoverable.toFixed(2),
        impairmentAmount: '0.00',
        type: 'depreciation',
        journalEntryId: null,
        note: dto.note ?? null,
        createdById: actorId,
      });
    }

    // Comptes : 29x dépend de la classe d'immo.
    const assetAccount = await this.accountsRepo.findById(
      asset.assetAccountId,
      organizationId,
    );
    if (!assetAccount) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_FOUND, {
        message: `Asset account ${asset.assetAccountId} not found in chart of accounts.`,
      });
    }
    const contraCode = depreciationContraAccountFor(assetAccount.code);
    const expenseCode = ASSET_IMPAIRMENT_EXPENSE_ACCOUNT;
    const reversalCode = ASSET_IMPAIRMENT_REVERSAL_ACCOUNT;

    const lines: CreateLineInput[] =
      type === 'depreciation'
        ? [
            {
              accountCode: expenseCode,
              debit: impairmentAmount,
              credit: 0,
              description: `Dotation dépréciation ${asset.code}`,
            },
            {
              accountCode: contraCode,
              debit: 0,
              credit: impairmentAmount,
              description: `Dépréciation cumulée ${asset.code}`,
            },
          ]
        : [
            {
              accountCode: contraCode,
              debit: impairmentAmount,
              credit: 0,
              description: `Reprise dépréciation ${asset.code}`,
            },
            {
              accountCode: reversalCode,
              debit: 0,
              credit: impairmentAmount,
              description: `Reprise dépréciation ${asset.code}`,
            },
          ];

    return this.dataSource.transaction(async () => {
      const entryView = await this.entriesService.createDraft(
        organizationId,
        {
          journalCode: OD_JOURNAL_CODE,
          entryDate: dto.testDate,
          description:
            type === 'depreciation'
              ? `Dépréciation ${asset.label} (${asset.code})`
              : `Reprise dépréciation ${asset.label} (${asset.code})`,
          lines,
          sourceType: 'impairment',
        },
        actorId,
        ctx,
      );
      await this.entriesService.validate(organizationId, entryView.id, actorId, ctx);

      const persisted = await this.assetImpairmentsRepo.create({
        organizationId,
        assetId: dto.assetId,
        testDate: dto.testDate,
        carryingAmount: carrying.toFixed(2),
        recoverableAmount: recoverable.toFixed(2),
        impairmentAmount: impairmentAmount.toFixed(2),
        type,
        journalEntryId: entryView.id,
        note: dto.note ?? null,
        createdById: actorId,
      });

      await this.emitAudit(
        type === 'depreciation' ? 'asset_impairment_recorded' : 'asset_impairment_reversed',
        persisted.id,
        {
          assetId: dto.assetId,
          assetCode: asset.code,
          testDate: dto.testDate,
          carryingAmount: carrying.toFixed(2),
          recoverableAmount: recoverable.toFixed(2),
          impairmentAmount: impairmentAmount.toFixed(2),
          journalEntryId: entryView.id,
        },
        ctx,
        actorId,
        organizationId,
      );

      return persisted;
    });
  }

  // ─── Inventory impairment ─────────────────────────────────────────

  async testInventoryImpairment(
    organizationId: TenantId,
    dto: TestInventoryImpairmentDto,
    actorId: string,
    ctx: AuditContext,
  ): Promise<InventoryImpairmentEntity> {
    assertTenantId(organizationId);

    const item = await this.inventoryItemsRepo.findById(dto.inventoryItemId, organizationId);
    if (!item) {
      throw new AppException(ERROR_CODES.IMPAIRMENT_INVENTORY_NOT_FOUND, {
        message: `Inventory item '${dto.inventoryItemId}' not found in this organization.`,
      });
    }

    const nrv = this.parseAmount(dto.nrv, 'nrv');
    const carrying = this.round2(Number(item.currentCmp) * Number(item.currentQty));
    if (carrying < -EPSILON) {
      throw new AppException(ERROR_CODES.IMPAIRMENT_INVALID_AMOUNT, {
        message: `Computed carrying amount is negative (${carrying}).`,
      });
    }

    const priorNetImpairment = await this.inventoryImpairmentsRepo.sumNetImpairmentsForItem(
      dto.inventoryItemId,
      organizationId,
    );

    const diff = carrying - nrv;
    let type: ImpairmentType;
    let impairmentAmount: number;

    if (diff > EPSILON) {
      type = 'depreciation';
      impairmentAmount = this.round2(diff);
    } else if (diff < -EPSILON && priorNetImpairment > EPSILON) {
      type = 'reprise';
      const wantedReprise = this.round2(-diff);
      if (wantedReprise > priorNetImpairment + EPSILON) {
        throw new AppException(ERROR_CODES.IMPAIRMENT_REPRISE_EXCEEDS_HISTORY, {
          message: `Reprise ${wantedReprise} exceeds cumulated impairments (${priorNetImpairment.toFixed(2)}).`,
          details: { wantedReprise, priorNetImpairment },
        });
      }
      impairmentAmount = wantedReprise;
    } else {
      return this.inventoryImpairmentsRepo.create({
        organizationId,
        inventoryItemId: dto.inventoryItemId,
        testDate: dto.testDate,
        carryingAmount: carrying.toFixed(2),
        nrv: nrv.toFixed(2),
        impairmentAmount: '0.00',
        type: 'depreciation',
        journalEntryId: null,
        note: dto.note ?? null,
        createdById: actorId,
      });
    }

    const stockAccount = await this.accountsRepo.findById(
      item.stockAccountId,
      organizationId,
    );
    if (!stockAccount) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_FOUND, {
        message: `Stock account ${item.stockAccountId} not found in chart of accounts.`,
      });
    }
    const contraCode = inventoryContraAccountFor(stockAccount.code);
    const expenseCode = INVENTORY_IMPAIRMENT_EXPENSE_ACCOUNT;
    const reversalCode = INVENTORY_IMPAIRMENT_REVERSAL_ACCOUNT;

    const lines: CreateLineInput[] =
      type === 'depreciation'
        ? [
            {
              accountCode: expenseCode,
              debit: impairmentAmount,
              credit: 0,
              description: `Dotation dépréciation stock ${item.code}`,
            },
            {
              accountCode: contraCode,
              debit: 0,
              credit: impairmentAmount,
              description: `Dépréciation cumulée stock ${item.code}`,
            },
          ]
        : [
            {
              accountCode: contraCode,
              debit: impairmentAmount,
              credit: 0,
              description: `Reprise dépréciation stock ${item.code}`,
            },
            {
              accountCode: reversalCode,
              debit: 0,
              credit: impairmentAmount,
              description: `Reprise dépréciation stock ${item.code}`,
            },
          ];

    return this.dataSource.transaction(async () => {
      const entryView = await this.entriesService.createDraft(
        organizationId,
        {
          journalCode: OD_JOURNAL_CODE,
          entryDate: dto.testDate,
          description:
            type === 'depreciation'
              ? `Dépréciation stock ${item.label} (${item.code})`
              : `Reprise dépréciation stock ${item.label} (${item.code})`,
          lines,
          sourceType: 'impairment',
        },
        actorId,
        ctx,
      );
      await this.entriesService.validate(organizationId, entryView.id, actorId, ctx);

      const persisted = await this.inventoryImpairmentsRepo.create({
        organizationId,
        inventoryItemId: dto.inventoryItemId,
        testDate: dto.testDate,
        carryingAmount: carrying.toFixed(2),
        nrv: nrv.toFixed(2),
        impairmentAmount: impairmentAmount.toFixed(2),
        type,
        journalEntryId: entryView.id,
        note: dto.note ?? null,
        createdById: actorId,
      });

      await this.emitAudit(
        type === 'depreciation'
          ? 'inventory_impairment_recorded'
          : 'inventory_impairment_reversed',
        persisted.id,
        {
          inventoryItemId: dto.inventoryItemId,
          itemCode: item.code,
          testDate: dto.testDate,
          carryingAmount: carrying.toFixed(2),
          nrv: nrv.toFixed(2),
          impairmentAmount: impairmentAmount.toFixed(2),
          journalEntryId: entryView.id,
        },
        ctx,
        actorId,
        organizationId,
      );

      return persisted;
    });
  }

  // ─── Queries ──────────────────────────────────────────────────────

  async listAssetImpairments(
    organizationId: TenantId,
    assetId?: string,
    limit = 100,
  ): Promise<AssetImpairmentEntity[]> {
    assertTenantId(organizationId);
    return this.assetImpairmentsRepo.listByOrganization(organizationId, assetId, limit);
  }

  async listInventoryImpairments(
    organizationId: TenantId,
    inventoryItemId?: string,
    limit = 100,
  ): Promise<InventoryImpairmentEntity[]> {
    assertTenantId(organizationId);
    return this.inventoryImpairmentsRepo.listByOrganization(
      organizationId,
      inventoryItemId,
      limit,
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────

  /**
   * VNC d'un asset à `testDate`. On lit l'échéancier et on prend la
   * `netBookValue` de la dernière ligne dont `periodEnd ≤ testDate`.
   * Si aucune ligne (asset pas encore amorti) → cost − residual.
   */
  private async computeAssetCarryingAmount(
    assetId: string,
    organizationId: TenantId,
    testDate: string,
    acquisitionCost: string,
    residualValue: string,
  ): Promise<number> {
    const schedule = await this.schedulesRepo.listByAsset(assetId, organizationId);
    const applicable = schedule
      .filter((line) => line.periodEnd <= testDate)
      .sort((a, b) => b.fiscalYear - a.fiscalYear);

    if (applicable.length === 0) {
      return this.round2(Number(acquisitionCost) - Number(residualValue));
    }
    return this.round2(Number(applicable[0].netBookValue));
  }

  private parseAmount(raw: string, field: string): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new AppException(ERROR_CODES.IMPAIRMENT_INVALID_AMOUNT, {
        message: `Invalid ${field}: must be a non-negative number, got '${raw}'.`,
      });
    }
    return this.round2(n);
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  private async emitAudit(
    action: string,
    entityId: string,
    data: Record<string, unknown>,
    ctx: AuditContext,
    actorId: string,
    organizationId: TenantId | string,
  ): Promise<void> {
    await this.audit
      .record({
        module: ImpairmentsService.MODULE,
        action,
        entityType: 'impairment',
        entityId,
        after: data,
        ctx: { ...ctx, userId: actorId, organizationId },
      })
      .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));
  }
}
