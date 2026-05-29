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
import { DISPOSAL_ACCOUNT_CODES, type DisposeAssetDto } from '../dto/dispose-asset.dto';
import {
  computeLinearSchedule,
  computeDecliningSchedule,
  computeSoftySchedule,
  computeUnitsOfProductionSchedule,
  computeDerogatorySchedule,
  computePartialYearDepreciation,
  DerogatoryConfigInvalidError,
  UopUnitsOverflowError,
  UopUnitsRequiredError,
  type DepreciationInput,
  type DepreciationLine,
  type DerogatoryScheduleEntry,
} from './depreciation-calculator';
import type { DerogatoryConfig } from '../types/asset.types';

/**
 * Récapitulatif d'une écriture comptable générée par `dispose()`.
 * Retourné au caller pour traçabilité (UI peut afficher les trois écritures
 * sans relancer un fetch des journal_entries).
 */
export interface DisposalJournalEntrySummary {
  readonly id: string;
  readonly type: 'prorata_depreciation' | 'asset_writeoff' | 'disposal_proceeds';
  readonly lines: ReadonlyArray<{
    readonly accountCode: string;
    readonly debit: number;
    readonly credit: number;
  }>;
}

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

    // W4.3 — validation upstream (avant DB).
    this.validateUopInputs(dto.depreciationMethod, dto.totalUnits, dto.unitsPerYear);
    const derogatoryCfg = this.normalizeDerogatoryConfig(dto);

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
          totalUnits: dto.totalUnits != null ? String(dto.totalUnits) : null,
          unitsPerYear: dto.unitsPerYear ?? null,
          derogatoryEnabled: derogatoryCfg?.enabled ?? false,
          derogatoryFiscalMethod: derogatoryCfg?.fiscalMethod ?? null,
          derogatoryFiscalDuration: derogatoryCfg?.fiscalDuration ?? null,
          derogatoryFiscalDecliningRate:
            derogatoryCfg?.fiscalDecliningRate != null
              ? String(derogatoryCfg.fiscalDecliningRate)
              : null,
        },
        manager,
      );

      const lines = this.computeScheduleLines(asset);
      const derogatoryEntries = derogatoryCfg
        ? this.computeDerogatoryLines(asset, derogatoryCfg)
        : [];
      const derogatoryByYear = new Map<number, DerogatoryScheduleEntry>(
        derogatoryEntries.map((e) => [e.fiscalYear, e]),
      );

      const schedule = await this.schedulesRepo.createMany(
        lines.map((line) => {
          const dero = derogatoryByYear.get(line.fiscalYear);
          return {
            organizationId,
            assetId: asset.id,
            fiscalYear: line.fiscalYear,
            periodStart: line.periodStart,
            periodEnd: line.periodEnd,
            depreciationAmount: line.depreciationAmount,
            cumulativeDepreciation: line.cumulativeDepreciation,
            netBookValue: line.netBookValue,
            status: 'pending' as const,
            economicAmount: dero ? dero.economicAmount : null,
            fiscalAmount: dero ? dero.fiscalAmount : null,
            derogatoryDotation: dero ? dero.dotationAmount : null,
            derogatoryReprise: dero ? dero.repriseAmount : null,
          };
        }),
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

  // ─── Dispose (W3.3 — cession complète SYSCOHADA) ────────────────────

  /**
   * Cède une immobilisation et génère les écritures comptables
   * SYSCOHADA correspondantes (App. 33 / 66 / 110, Tome 1 G04).
   *
   * Trois écritures peuvent être émises, toutes via
   * `EntriesService.createDraft` puis `validate` (donc atomiquement
   * postées) :
   *
   *  1. **Dotation prorata** — D 681 / C 28x pour la part d'amortissement
   *     courue depuis la dernière dotation postée (ou depuis le début de
   *     l'exercice) jusqu'à la date de cession. Émise uniquement si le
   *     montant prorata est > 0.
   *  2. **Sortie du bilan** — selon `disposalKind` :
   *       - `recurring` : D 654 (VNC) + D 28x (cumul amort) / C 23-24 (brut).
   *       - `hao`       : D 812 (VNC) + D 28x (cumul amort) / C 23-24 (brut).
   *     Toujours émise (même si proceeds = 0).
   *  3. **Prix de cession** — selon `disposalKind` :
   *       - `recurring` : D 5121 ou 411 / C 754.
   *       - `hao`       : D 485 ou 411 / C 822.
   *     Émise uniquement si `proceedsAmount > 0` (rebut → pas d'écriture
   *     produit).
   *
   * Le gain/perte n'est PAS comptabilisé sur une écriture séparée — il
   * est implicite dans le delta proceeds vs VNC sur les comptes 754/822
   * vs 654/812. On le persiste en `disposal_value` (proceeds) à titre
   * informatif, mais le journal porte la vérité comptable.
   *
   * Toutes les écritures portent `sourceType: 'depreciation'` (réutilise
   * la catégorie existante — le système comptable les retrouve via le
   * code asset embarqué dans la description). À terme W4, on ajoutera
   * un sourceType dédié `asset_disposal`.
   */
  async dispose(
    id: string,
    organizationId: TenantId,
    dto: DisposeAssetDto,
    actorId: string,
    ctx: AuditContext,
    journalCode = 'OD',
  ): Promise<{ asset: AssetEntity; journalEntries: DisposalJournalEntrySummary[] }> {
    assertTenantId(organizationId);
    const asset = await this.findById(id, organizationId);

    // ─── Guards ─────────────────────────────────────────────────────
    if (asset.status === 'disposed') {
      throw new AppException(ERROR_CODES.ASSET_ALREADY_DISPOSED, {
        message: `Asset '${asset.code}' is already disposed (on ${asset.disposalDate}).`,
      });
    }
    if (dto.disposalDate < asset.acquisitionDate) {
      throw new AppException(ERROR_CODES.ASSET_DISPOSAL_INVALID_DATE, {
        message: `Disposal date ${dto.disposalDate} precedes acquisition date ${asset.acquisitionDate}.`,
      });
    }
    const proceedsNum = Number(dto.proceedsAmount);
    if (!Number.isFinite(proceedsNum) || proceedsNum < 0) {
      throw new AppException(ERROR_CODES.ASSET_DISPOSAL_INVALID_DATE, {
        message: `proceedsAmount must be a non-negative number, got "${dto.proceedsAmount}".`,
      });
    }

    // ─── Load schedules (posted + pending) ─────────────────────────
    const schedules = await this.schedulesRepo.listByAsset(id, organizationId);
    const postedSchedules = schedules.filter((s) => s.status === 'posted');
    const cumulPostedCents = postedSchedules.reduce(
      (acc, s) => acc + Math.round(Number(s.depreciationAmount) * 100),
      0,
    );

    // Last posted period end — anchor for the prorata.
    const lastPostedEnd = postedSchedules.reduce<string | null>((acc, s) => {
      if (!acc || s.periodEnd > acc) return s.periodEnd;
      return acc;
    }, null);

    // Prorata window : day after lastPostedEnd → disposalDate. If no
    // dotation has ever been posted, start from the put-in-service date
    // (or 01/01 of the disposal year, whichever is later — but
    // simplest/safest is from putInServiceDate).
    const proratStart = lastPostedEnd ? this.addOneDay(lastPostedEnd) : asset.putInServiceDate;

    const { amount: proratAmountStr, daysProrated } = computePartialYearDepreciation(
      {
        acquisitionCost: asset.acquisitionCost,
        residualValue: asset.residualValue,
        putInServiceDate: asset.putInServiceDate,
        durationMonths: asset.durationMonths,
        method: asset.depreciationMethod,
        decliningRate: asset.decliningRate,
        accumulatedDepreciation: (cumulPostedCents / 100).toFixed(2),
      },
      proratStart,
      dto.disposalDate,
    );
    const proratAmountCents = Math.round(Number(proratAmountStr) * 100);

    // ─── Resolve accounts (codes → ids) up-front so errors fail
    //     before any draft entry is written. The asset's original
    //     accountCode is resolved via its asset_account_id.
    const [
      assetAccountCode,
      depreciationAccountCode,
      expenseAccountCode,
      vncAccountCode,
      proceedsAccountCode,
      defaultProceedsContraCode,
    ] = await Promise.all([
      this.resolveAccountIdToCode(asset.assetAccountId, organizationId),
      this.resolveAccountIdToCode(asset.depreciationAccountId, organizationId),
      this.resolveAccountIdToCode(asset.expenseAccountId, organizationId),
      this.requireAccountByCode(
        DISPOSAL_ACCOUNT_CODES[dto.disposalKind].vnc,
        organizationId,
        'disposalVncAccount',
      ).then((a) => a.code),
      this.requireAccountByCode(
        DISPOSAL_ACCOUNT_CODES[dto.disposalKind].proceeds,
        organizationId,
        'disposalProceedsAccount',
      ).then((a) => a.code),
      proceedsNum > 0
        ? this.requireAccountByCode(
            dto.proceedsAccountCode ??
              DISPOSAL_ACCOUNT_CODES[dto.disposalKind].defaultProceedsAccount,
            organizationId,
            'proceedsContraAccount',
          ).then((a) => a.code)
        : Promise.resolve('' as string),
    ]);

    // ─── Compute final figures ─────────────────────────────────────
    const grossCents = Math.round(Number(asset.acquisitionCost) * 100);
    const totalCumulCents = cumulPostedCents + proratAmountCents;
    const vncCents = Math.max(0, grossCents - totalCumulCents);
    const proceedsCents = Math.round(proceedsNum * 100);
    const gainLossCents = proceedsCents - vncCents;

    const journalEntries: DisposalJournalEntrySummary[] = [];

    return this.dataSource.transaction(async (_manager) => {
      // ─── 1. Prorata dotation (D 681 / C 28x) ────────────────────
      if (proratAmountCents > 0) {
        const proratLines: CreateLineInput[] = [
          {
            accountCode: expenseAccountCode,
            debit: proratAmountCents / 100,
            credit: 0,
            description: `Dotation prorata cession ${asset.code} (${daysProrated} j)`,
          },
          {
            accountCode: depreciationAccountCode,
            debit: 0,
            credit: proratAmountCents / 100,
            description: `Amort. cumulé prorata cession ${asset.code}`,
          },
        ];
        const proratEntry = await this.entriesService.createDraft(
          organizationId,
          {
            journalCode,
            entryDate: dto.disposalDate,
            description: `Dotation prorata cession — ${asset.label} (${asset.code})`,
            lines: proratLines,
            sourceType: 'depreciation',
          },
          actorId,
          ctx,
        );
        await this.entriesService.validate(organizationId, proratEntry.id, actorId, ctx);
        journalEntries.push({
          id: proratEntry.id,
          type: 'prorata_depreciation',
          lines: proratLines.map((l) => ({
            accountCode: l.accountCode,
            debit: l.debit,
            credit: l.credit,
          })),
        });
      }

      // ─── 2. Sortie du bilan ─────────────────────────────────────
      // Equation : D VNC + D 28x = C 23-24 (brut)
      // Si totalCumul == 0 (asset fraîchement acquis), une seule ligne
      // débit suffit ; même cas si VNC == 0 (totalement amorti).
      const sortieLines: CreateLineInput[] = [];
      if (vncCents > 0) {
        sortieLines.push({
          accountCode: vncAccountCode,
          debit: vncCents / 100,
          credit: 0,
          description: `VNC sortie ${dto.disposalKind === 'hao' ? 'HAO' : 'courante'} ${asset.code}`,
        });
      }
      if (totalCumulCents > 0) {
        sortieLines.push({
          accountCode: depreciationAccountCode,
          debit: totalCumulCents / 100,
          credit: 0,
          description: `Reprise amort. cumulé ${asset.code}`,
        });
      }
      sortieLines.push({
        accountCode: assetAccountCode,
        debit: 0,
        credit: grossCents / 100,
        description: `Sortie bilan ${asset.code} — ${dto.disposalDate}`,
      });

      const sortieEntry = await this.entriesService.createDraft(
        organizationId,
        {
          journalCode,
          entryDate: dto.disposalDate,
          description: `Sortie ${dto.disposalKind === 'hao' ? 'HAO' : 'courante'} — ${asset.label} (${asset.code})`,
          lines: sortieLines,
          sourceType: 'depreciation',
        },
        actorId,
        ctx,
      );
      await this.entriesService.validate(organizationId, sortieEntry.id, actorId, ctx);
      journalEntries.push({
        id: sortieEntry.id,
        type: 'asset_writeoff',
        lines: sortieLines.map((l) => ({
          accountCode: l.accountCode,
          debit: l.debit,
          credit: l.credit,
        })),
      });

      // ─── 3. Prix de cession ─────────────────────────────────────
      if (proceedsCents > 0) {
        const proceedsLines: CreateLineInput[] = [
          {
            accountCode: defaultProceedsContraCode,
            debit: proceedsCents / 100,
            credit: 0,
            description: `Prix cession ${asset.code} — encaissé / dû`,
          },
          {
            accountCode: proceedsAccountCode,
            debit: 0,
            credit: proceedsCents / 100,
            description: `Produit cession ${dto.disposalKind === 'hao' ? 'HAO' : 'courante'} ${asset.code}`,
          },
        ];
        const proceedsEntry = await this.entriesService.createDraft(
          organizationId,
          {
            journalCode,
            entryDate: dto.disposalDate,
            description: `Prix de cession — ${asset.label} (${asset.code})`,
            lines: proceedsLines,
            sourceType: 'depreciation',
          },
          actorId,
          ctx,
        );
        await this.entriesService.validate(organizationId, proceedsEntry.id, actorId, ctx);
        journalEntries.push({
          id: proceedsEntry.id,
          type: 'disposal_proceeds',
          lines: proceedsLines.map((l) => ({
            accountCode: l.accountCode,
            debit: l.debit,
            credit: l.credit,
          })),
        });
      }

      // ─── 4. Clean pending schedules + update asset ──────────────
      await this.schedulesRepo.deletePendingByAsset(id, organizationId, _manager);
      const disposed = await this.assetsRepo.update(
        id,
        organizationId,
        {
          status: 'disposed',
          disposalDate: dto.disposalDate,
          disposalValue: (proceedsCents / 100).toFixed(2),
        },
        _manager,
      );

      await this.emitAudit(
        'asset_disposed',
        id,
        {
          code: asset.code,
          disposalDate: dto.disposalDate,
          disposalKind: dto.disposalKind,
          proceedsAmount: (proceedsCents / 100).toFixed(2),
          grossAmount: (grossCents / 100).toFixed(2),
          totalCumulativeDepreciation: (totalCumulCents / 100).toFixed(2),
          proratAmount: (proratAmountCents / 100).toFixed(2),
          proratDays: daysProrated,
          netBookValue: (vncCents / 100).toFixed(2),
          gainLoss: (gainLossCents / 100).toFixed(2),
          journalEntries: journalEntries.map((e) => ({ id: e.id, type: e.type })),
          note: dto.note ?? null,
        },
        ctx,
        actorId,
        organizationId,
      );

      return { asset: disposed, journalEntries };
    });
  }

  private addOneDay(ymd: string): string {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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

    // W4.3 — Amortissements dérogatoires : ajouter D 851 / C 151
    // ou D 151 / C 861 selon dotation/reprise.
    const dotation = Number(schedule.derogatoryDotation ?? 0);
    const reprise = Number(schedule.derogatoryReprise ?? 0);
    if (dotation > 0) {
      const [doteAccount, provAccount] = await Promise.all([
        this.requireAccountByCode('851', organizationId, 'derogatoryDotationAccount'),
        this.requireAccountByCode('151', organizationId, 'provisionRegulatedAccount'),
      ]);
      lines.push({
        accountCode: doteAccount.code,
        debit: dotation,
        credit: 0,
        description: `Dotation provisions réglementées (amort. dérog.) ${asset.code}`,
      });
      lines.push({
        accountCode: provAccount.code,
        debit: 0,
        credit: dotation,
        description: `Provision réglementée — amort. dérog. ${asset.code}`,
      });
    }
    if (reprise > 0) {
      const [provAccount, repriseAccount] = await Promise.all([
        this.requireAccountByCode('151', organizationId, 'provisionRegulatedAccount'),
        this.requireAccountByCode('861', organizationId, 'derogatoryRepriseAccount'),
      ]);
      lines.push({
        accountCode: provAccount.code,
        debit: reprise,
        credit: 0,
        description: `Reprise provision réglementée — amort. dérog. ${asset.code}`,
      });
      lines.push({
        accountCode: repriseAccount.code,
        debit: 0,
        credit: reprise,
        description: `Reprise sur provisions réglementées (amort. dérog.) ${asset.code}`,
      });
    }

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
    switch (asset.depreciationMethod) {
      case 'linear':
        return computeLinearSchedule(input);
      case 'declining':
        return computeDecliningSchedule(input);
      case 'softy':
        return computeSoftySchedule(input);
      case 'units_of_production':
        if (!asset.totalUnits || !asset.unitsPerYear) {
          throw new AppException(ERROR_CODES.ASSET_UOP_UNITS_REQUIRED, {
            message: `Asset '${asset.code}': totalUnits and unitsPerYear are required for UOP method.`,
          });
        }
        try {
          return computeUnitsOfProductionSchedule({
            ...input,
            totalUnits: Number(asset.totalUnits),
            unitsPerYear: asset.unitsPerYear,
          });
        } catch (err) {
          if (err instanceof UopUnitsOverflowError) {
            throw new AppException(ERROR_CODES.ASSET_UOP_UNITS_OVERFLOW, {
              message: err.message,
            });
          }
          if (err instanceof UopUnitsRequiredError) {
            throw new AppException(ERROR_CODES.ASSET_UOP_UNITS_REQUIRED, {
              message: err.message,
            });
          }
          throw err;
        }
    }
  }

  private computeDerogatoryLines(
    asset: AssetEntity,
    cfg: DerogatoryConfig,
  ): DerogatoryScheduleEntry[] {
    try {
      return computeDerogatorySchedule({
        acquisitionCost: asset.acquisitionCost,
        residualValue: asset.residualValue,
        putInServiceDate: asset.putInServiceDate,
        durationMonths: asset.durationMonths,
        derogatory: cfg,
        decliningRate: asset.decliningRate,
        totalUnits: asset.totalUnits ? Number(asset.totalUnits) : undefined,
        unitsPerYear: asset.unitsPerYear ?? undefined,
      });
    } catch (err) {
      if (err instanceof DerogatoryConfigInvalidError) {
        throw new AppException(ERROR_CODES.ASSET_DEROGATORY_CONFIG_INVALID, {
          message: err.message,
        });
      }
      if (err instanceof UopUnitsOverflowError) {
        throw new AppException(ERROR_CODES.ASSET_UOP_UNITS_OVERFLOW, { message: err.message });
      }
      if (err instanceof UopUnitsRequiredError) {
        throw new AppException(ERROR_CODES.ASSET_UOP_UNITS_REQUIRED, { message: err.message });
      }
      throw err;
    }
  }

  private validateUopInputs(
    method: AssetEntity['depreciationMethod'],
    totalUnits: number | undefined,
    unitsPerYear: number[] | undefined,
  ): void {
    if (method !== 'units_of_production') return;
    if (!totalUnits || totalUnits <= 0 || !unitsPerYear || unitsPerYear.length === 0) {
      throw new AppException(ERROR_CODES.ASSET_UOP_UNITS_REQUIRED, {
        message: 'units_of_production requires totalUnits > 0 and a non-empty unitsPerYear array.',
      });
    }
    const sum = unitsPerYear.reduce((s, u) => s + (Number(u) || 0), 0);
    if (sum - totalUnits > 0.5) {
      throw new AppException(ERROR_CODES.ASSET_UOP_UNITS_OVERFLOW, {
        message: `sum(unitsPerYear)=${sum} exceeds totalUnits=${totalUnits}.`,
      });
    }
  }

  private normalizeDerogatoryConfig(dto: CreateAssetDto): DerogatoryConfig | null {
    if (!dto.derogatory || !dto.derogatory.enabled) return null;
    const d = dto.derogatory;
    if (!d.fiscalMethod) {
      throw new AppException(ERROR_CODES.ASSET_DEROGATORY_CONFIG_INVALID, {
        message: 'derogatory.fiscalMethod is required when derogatory.enabled=true.',
      });
    }
    const economicMethod = d.economicMethod ?? dto.depreciationMethod;
    if (d.fiscalMethod === 'declining' && !d.fiscalDecliningRate) {
      throw new AppException(ERROR_CODES.ASSET_DEROGATORY_CONFIG_INVALID, {
        message: 'derogatory.fiscalDecliningRate is required when fiscalMethod=declining.',
      });
    }
    return {
      enabled: true,
      fiscalMethod: d.fiscalMethod,
      economicMethod,
      fiscalDuration: d.fiscalDuration,
      fiscalDecliningRate: d.fiscalDecliningRate ?? null,
    };
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
