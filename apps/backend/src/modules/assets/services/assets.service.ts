import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { OrganizationAccountRepository } from '../../accounting-plan/repositories/organization-account.repository';
import { EntriesService, type CreateLineInput } from '../../journals/services/entries.service';
import { AssetEntity } from '../entities/asset.entity';
import { DepreciationScheduleEntity } from '../entities/depreciation-schedule.entity';
import { AssetsRepository } from '../repositories/assets.repository';
import { DepreciationSchedulesRepository } from '../repositories/depreciation-schedules.repository';
import { CreateAssetDto } from '../dto/create-asset.dto';
import { UpdateAssetDto } from '../dto/update-asset.dto';
import {
  computeLinearSchedule,
  computeDecliningSchedule,
  type DepreciationInput,
  type DepreciationLine,
} from './depreciation-calculator';

@Injectable()
export class AssetsService {
  private static readonly MODULE = 'assets' as const;
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly assetsRepo: AssetsRepository,
    private readonly schedulesRepo: DepreciationSchedulesRepository,
    private readonly accountsRepo: OrganizationAccountRepository,
    private readonly entriesService: EntriesService,
    private readonly audit: AuditTrailService,
  ) {}

  // ─── Queries ────────────────────────────────────────────────────────

  async listForOrg(organizationId: TenantId): Promise<AssetEntity[]> {
    assertTenantId(organizationId);
    return this.assetsRepo.listByOrganization(organizationId);
  }

  async findById(id: string, organizationId: TenantId): Promise<AssetEntity> {
    assertTenantId(organizationId);
    const asset = await this.assetsRepo.findById(id, organizationId);
    if (!asset) {
      throw new AppException(ERROR_CODES.ASSET_NOT_FOUND, {
        message: `Asset '${id}' not found.`,
      });
    }
    return asset;
  }

  async getSchedule(
    assetId: string,
    organizationId: TenantId,
  ): Promise<DepreciationScheduleEntity[]> {
    assertTenantId(organizationId);
    // Ensure asset exists (throws if not).
    await this.findById(assetId, organizationId);
    return this.schedulesRepo.listByAsset(assetId, organizationId);
  }

  // ─── Create ─────────────────────────────────────────────────────────

  /**
   * Register a new fixed asset and compute its full depreciation schedule.
   *
   * Runs inside a single transaction:
   *   1. Resolve the three SYSCOHADA account codes → UUIDs (tenant-scoped).
   *   2. Insert the asset row.
   *   3. Compute the schedule (pure-function calculator).
   *   4. Bulk-insert all schedule lines as `pending`.
   *
   * `putInServiceDate` defaults to `acquisitionDate` when omitted — the
   * two dates coincide in the majority of OHADA cases.
   */
  async create(
    organizationId: TenantId,
    dto: CreateAssetDto,
    actorId: string,
    ctx: AuditContext,
  ): Promise<{ asset: AssetEntity; schedule: DepreciationScheduleEntity[] }> {
    assertTenantId(organizationId);

    // Guard: unique code.
    const existing = await this.assetsRepo.findByCode(organizationId, dto.code);
    if (existing) {
      throw new AppException(ERROR_CODES.ASSET_CODE_TAKEN, {
        message: `Asset code '${dto.code}' already exists in this organization.`,
      });
    }

    // Resolve the three accounts up-front so a bad code fails fast,
    // BEFORE we even open the transaction. All three lookups in
    // parallel; the FK constraints would catch a wrong UUID later but
    // the error message would be opaque.
    const [assetAccount, depreciationAccount, expenseAccount] = await Promise.all([
      this.requireAccountByCode(dto.assetAccountCode, organizationId, 'assetAccountCode'),
      this.requireAccountByCode(
        dto.depreciationAccountCode,
        organizationId,
        'depreciationAccountCode',
      ),
      this.requireAccountByCode(dto.expenseAccountCode, organizationId, 'expenseAccountCode'),
    ]);

    const putInServiceDate = dto.putInServiceDate ?? dto.acquisitionDate;

    return this.dataSource.transaction(async (manager) => {
      const asset = await this.assetsRepo.create(
        {
          organizationId,
          code: dto.code,
          label: dto.label,
          acquisitionDate: dto.acquisitionDate,
          putInServiceDate,
          acquisitionCost: dto.acquisitionCost,
          residualValue: dto.residualValue ?? '0.00',
          depreciationMethod: dto.depreciationMethod,
          durationMonths: dto.durationMonths,
          decliningRate: dto.decliningRate ?? null,
          assetAccountId: assetAccount.id,
          depreciationAccountId: depreciationAccount.id,
          expenseAccountId: expenseAccount.id,
          createdById: actorId,
        },
        manager,
      );

      const lines = this.computeScheduleLines(asset);
      const schedule = await this.schedulesRepo.createMany(
        lines.map((line) => ({
          organizationId,
          assetId: asset.id,
          fiscalYear: line.fiscalYear,
          periodStart: line.periodStart,
          periodEnd: line.periodEnd,
          depreciationAmount: line.depreciationAmount,
          cumulativeDepreciation: line.cumulativeDepreciation,
          netBookValue: line.netBookValue,
          status: 'pending' as const,
        })),
        manager,
      );

      await this.emitAudit(
        'asset_created',
        asset.id,
        {
          code: asset.code,
          label: asset.label,
          acquisitionCost: asset.acquisitionCost,
          depreciationMethod: asset.depreciationMethod,
          durationMonths: asset.durationMonths,
          scheduleLines: schedule.length,
        },
        ctx,
        actorId,
        organizationId,
      );

      return { asset, schedule };
    });
  }

  // ─── Update ─────────────────────────────────────────────────────────

  /**
   * Update mutable fields of an asset and regenerate the depreciation
   * schedule if any financial parameter changed.
   *
   * Only `pending` schedule lines are replaced; `posted` lines are
   * immutable (they already created journal entries).
   */
  async update(
    id: string,
    organizationId: TenantId,
    dto: UpdateAssetDto,
    actorId: string,
    ctx: AuditContext,
  ): Promise<{ asset: AssetEntity; schedule: DepreciationScheduleEntity[] }> {
    assertTenantId(organizationId);
    const asset = await this.findById(id, organizationId);

    const before = this.snapshot(asset);

    // Resolve any provided account codes BEFORE building the patch so
    // an invalid code fails before we touch the DB.
    const patch: Partial<AssetEntity> = {};
    if (dto.label !== undefined) patch.label = dto.label;
    if (dto.acquisitionDate !== undefined) patch.acquisitionDate = dto.acquisitionDate;
    if (dto.putInServiceDate !== undefined) patch.putInServiceDate = dto.putInServiceDate;
    if (dto.acquisitionCost !== undefined) patch.acquisitionCost = dto.acquisitionCost;
    if (dto.residualValue !== undefined) patch.residualValue = dto.residualValue;
    if (dto.depreciationMethod !== undefined) patch.depreciationMethod = dto.depreciationMethod;
    if (dto.durationMonths !== undefined) patch.durationMonths = dto.durationMonths;
    if (dto.decliningRate !== undefined) patch.decliningRate = dto.decliningRate;
    if (dto.assetAccountCode !== undefined) {
      const account = await this.requireAccountByCode(
        dto.assetAccountCode,
        organizationId,
        'assetAccountCode',
      );
      patch.assetAccountId = account.id;
    }
    if (dto.depreciationAccountCode !== undefined) {
      const account = await this.requireAccountByCode(
        dto.depreciationAccountCode,
        organizationId,
        'depreciationAccountCode',
      );
      patch.depreciationAccountId = account.id;
    }
    if (dto.expenseAccountCode !== undefined) {
      const account = await this.requireAccountByCode(
        dto.expenseAccountCode,
        organizationId,
        'expenseAccountCode',
      );
      patch.expenseAccountId = account.id;
    }

    // A "financial change" forces a schedule regeneration. Touching the
    // accounts doesn't because the schedule numbers only depend on
    // cost/duration/method/dates.
    const financialChanged =
      dto.acquisitionCost !== undefined ||
      dto.residualValue !== undefined ||
      dto.depreciationMethod !== undefined ||
      dto.durationMonths !== undefined ||
      dto.putInServiceDate !== undefined ||
      dto.decliningRate !== undefined;

    return this.dataSource.transaction(async (manager) => {
      const updated = await this.assetsRepo.update(id, organizationId, patch, manager);

      let schedule: DepreciationScheduleEntity[];
      if (financialChanged) {
        // Delete only pending schedules and regenerate.
        await this.schedulesRepo.deletePendingByAsset(id, organizationId, manager);
        const lines = this.computeScheduleLines(updated);
        schedule = await this.schedulesRepo.createMany(
          lines.map((line) => ({
            organizationId,
            assetId: id,
            fiscalYear: line.fiscalYear,
            periodStart: line.periodStart,
            periodEnd: line.periodEnd,
            depreciationAmount: line.depreciationAmount,
            cumulativeDepreciation: line.cumulativeDepreciation,
            netBookValue: line.netBookValue,
            status: 'pending' as const,
          })),
          manager,
        );
      } else {
        schedule = await this.schedulesRepo.listByAsset(id, organizationId);
      }

      const after = this.snapshot(updated);
      await this.emitAudit(
        'asset_updated',
        id,
        {
          before: this.diff(before, after),
          after: this.diff(after, before),
          financialChanged,
        },
        ctx,
        actorId,
        organizationId,
      );

      return { asset: updated, schedule };
    });
  }

  // ─── Dispose ────────────────────────────────────────────────────────

  /**
   * Mark an asset as disposed (cédé / mis au rebut).
   * Deletes all remaining `pending` schedule lines.
   */
  async dispose(
    id: string,
    organizationId: TenantId,
    disposalDate: string,
    disposalValue: string | null,
    actorId: string,
    ctx: AuditContext,
  ): Promise<AssetEntity> {
    assertTenantId(organizationId);
    const asset = await this.findById(id, organizationId);

    return this.dataSource.transaction(async (manager) => {
      await this.schedulesRepo.deletePendingByAsset(id, organizationId, manager);
      const disposed = await this.assetsRepo.update(
        id,
        organizationId,
        {
          status: 'disposed',
          disposalDate,
          disposalValue: disposalValue ?? null,
        },
        manager,
      );

      await this.emitAudit(
        'asset_disposed',
        id,
        {
          code: asset.code,
          disposalDate,
          disposalValue,
        },
        ctx,
        actorId,
        organizationId,
      );

      return disposed;
    });
  }

  // ─── Post Depreciation ──────────────────────────────────────────────

  /**
   * Post a pending depreciation schedule line as a journal entry.
   *
   * Creates a balanced draft entry (debit: expense 681x, credit:
   * depreciation 28x) and validates it immediately. Links the schedule
   * to the resulting journal entry id.
   */
  async postDepreciation(
    scheduleId: string,
    organizationId: TenantId,
    actorId: string,
    ctx: AuditContext,
    journalCode = 'OD',
  ): Promise<DepreciationScheduleEntity> {
    assertTenantId(organizationId);

    const schedule = await this.schedulesRepo.findById(scheduleId, organizationId);
    if (!schedule) {
      throw new AppException(ERROR_CODES.DEPRECIATION_SCHEDULE_NOT_FOUND, {
        message: `Depreciation schedule line '${scheduleId}' not found.`,
      });
    }
    if (schedule.status === 'posted') {
      throw new AppException(ERROR_CODES.DEPRECIATION_SCHEDULE_ALREADY_POSTED, {
        message: `Schedule line '${scheduleId}' is already posted.`,
      });
    }

    const asset = await this.findById(schedule.assetId, organizationId);
    const amount = Number(schedule.depreciationAmount);

    const [expenseAccountCode, depreciationAccountCode] = await Promise.all([
      this.resolveAccountIdToCode(asset.expenseAccountId, organizationId),
      this.resolveAccountIdToCode(asset.depreciationAccountId, organizationId),
    ]);

    // Build the two-line balanced entry.
    const lines: CreateLineInput[] = [
      {
        accountCode: expenseAccountCode,
        debit: amount,
        credit: 0,
        description: `Dotation amort. ${asset.code} — exercice ${schedule.fiscalYear}`,
      },
      {
        accountCode: depreciationAccountCode,
        debit: 0,
        credit: amount,
        description: `Amort. cumulé ${asset.code} — exercice ${schedule.fiscalYear}`,
      },
    ];

    // Create + validate entry via EntriesService.
    const entryView = await this.entriesService.createDraft(
      organizationId,
      {
        journalCode,
        entryDate: schedule.periodEnd,
        description: `Dotation aux amortissements — ${asset.label} (${asset.code}) — ${schedule.fiscalYear}`,
        lines,
        sourceType: 'depreciation',
      },
      actorId,
      ctx,
    );

    // Auto-validate the entry.
    await this.entriesService.validate(organizationId, entryView.id, actorId, ctx);

    // Mark schedule as posted.
    const posted = await this.schedulesRepo.update(scheduleId, organizationId, {
      status: 'posted',
      journalEntryId: entryView.id,
      postedAt: new Date(),
      postedById: actorId,
    });

    await this.emitAudit(
      'depreciation_posted',
      scheduleId,
      {
        assetCode: asset.code,
        fiscalYear: schedule.fiscalYear,
        amount: schedule.depreciationAmount,
        journalEntryId: entryView.id,
      },
      ctx,
      actorId,
      organizationId,
    );

    return posted;
  }

  // ─── Private helpers ────────────────────────────────────────────────

  private computeScheduleLines(asset: AssetEntity): DepreciationLine[] {
    const input: DepreciationInput = {
      acquisitionCost: asset.acquisitionCost,
      residualValue: asset.residualValue,
      putInServiceDate: asset.putInServiceDate,
      durationMonths: asset.durationMonths,
      method: asset.depreciationMethod,
      decliningRate: asset.decliningRate,
    };
    return asset.depreciationMethod === 'declining'
      ? computeDecliningSchedule(input)
      : computeLinearSchedule(input);
  }

  /**
   * Resolve an account CODE → entity (with UUID), scoped on the calling
   * tenant. Throws `CHART_ACCOUNT_NOT_FOUND` with the offending field
   * name in the message so the caller knows which of the three account
   * fields was rejected.
   */
  private async requireAccountByCode(
    code: string,
    organizationId: TenantId,
    fieldName: string,
  ): Promise<{ id: string; code: string }> {
    const account = await this.accountsRepo.findByCode(code, organizationId);
    if (!account) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_FOUND, {
        message: `Chart account '${code}' (${fieldName}) not found in this organization.`,
      });
    }
    return { id: account.id, code: account.code };
  }

  /**
   * Resolve a chart-of-accounts UUID → account code string, scoped on
   * the calling tenant. Used by `postDepreciation` to convert the FK
   * stored on the asset back to the code that `EntriesService.createDraft`
   * expects.
   */
  private async resolveAccountIdToCode(
    accountId: string,
    organizationId: TenantId,
  ): Promise<string> {
    const account = await this.accountsRepo.findById(accountId, organizationId);
    if (!account) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_FOUND, {
        message: `Account '${accountId}' not found in chart of accounts.`,
      });
    }
    return account.code;
  }

  private snapshot(asset: AssetEntity): Record<string, unknown> {
    return {
      label: asset.label,
      acquisitionDate: asset.acquisitionDate,
      putInServiceDate: asset.putInServiceDate,
      acquisitionCost: asset.acquisitionCost,
      residualValue: asset.residualValue,
      depreciationMethod: asset.depreciationMethod,
      durationMonths: asset.durationMonths,
      decliningRate: asset.decliningRate,
      assetAccountId: asset.assetAccountId,
      depreciationAccountId: asset.depreciationAccountId,
      expenseAccountId: asset.expenseAccountId,
    };
  }

  private diff(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(a)) {
      if (a[key] !== b[key]) result[key] = a[key];
    }
    return result;
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
        module: AssetsService.MODULE,
        action,
        entityType: 'asset',
        entityId,
        after: data,
        ctx: { ...ctx, userId: actorId, organizationId },
      })
      .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));
  }
}
