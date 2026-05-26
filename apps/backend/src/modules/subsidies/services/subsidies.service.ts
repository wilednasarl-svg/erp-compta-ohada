import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import { DepreciationSchedulesRepository } from '../../assets/repositories/depreciation-schedules.repository';
import {
  EntriesService,
  type CreateLineInput,
} from '../../journals/services/entries.service';
import { CreateSubsidyDto } from '../dto/create-subsidy.dto';
import { ReleaseSubsidyDto } from '../dto/release-subsidy.dto';
import { SubsidyEntity } from '../entities/subsidy.entity';
import { SubsidyReleaseEntity } from '../entities/subsidy-release.entity';
import { SubsidiesRepository } from '../repositories/subsidies.repository';
import { SubsidyReleasesRepository } from '../repositories/subsidy-releases.repository';
import {
  DEFAULT_GRANT_DEBIT_ACCOUNT,
  LINEAR_RELEASE_MONTHS,
  SUBSIDY_GRANT_LIABILITY_ACCOUNT,
  SUBSIDY_RELEASE_INCOME_ACCOUNT,
  type SubsidyStatus,
} from '../types/subsidy.types';

/**
 * Tolérance de comparaison décimale (2 décimales fixées NUMERIC(15,2)).
 */
const EPSILON = 0.005;

/**
 * Code journal par défaut pour octroi / reprise. `OD` (opérations
 * diverses) est seedé pour toute organisation SYSCOHADA.
 */
const DEFAULT_JOURNAL_CODE = 'OD' as const;

export interface ListSubsidiesOptions {
  readonly status?: SubsidyStatus;
  readonly assetId?: string;
}

export interface SubsidyWithReleases {
  readonly subsidy: SubsidyEntity;
  readonly releases: ReadonlyArray<SubsidyReleaseEntity>;
}

/**
 * W4.4 — Service applicatif des subventions d'investissement.
 *
 * Responsabilités :
 *   - création + écriture d'octroi (D 4494|521 / C 1411)
 *   - reprises au résultat (D 1411 / C 799) selon la méthode :
 *       * manual          : libre (montant + date passés par le caller)
 *       * on_depreciation : proportionnel à la dotation postée
 *       * linear_10y      : mensuel = totalAmount / 120
 *   - bascule automatique status='fully_released' quand
 *     `releasedAmount` rejoint `totalAmount`
 *   - garde-fou SUBSIDY_OVERRELEASE pour bloquer toute reprise qui
 *     dépasserait le montant restant
 *
 * Conventions :
 *   - montants `string` décimal "0.00" (NUMERIC 15,2)
 *   - immutabilité : on lit, on calcule, on persiste un patch
 *   - PAS de controller wave 1
 */
@Injectable()
export class SubsidiesService {
  private readonly logger = new Logger(SubsidiesService.name);

  constructor(
    private readonly subsidiesRepo: SubsidiesRepository,
    private readonly releasesRepo: SubsidyReleasesRepository,
    private readonly schedulesRepo: DepreciationSchedulesRepository,
    private readonly entriesService: EntriesService,
  ) {}

  // ─── Queries ────────────────────────────────────────────────────────

  async findById(
    organizationId: TenantId,
    id: string,
  ): Promise<SubsidyWithReleases> {
    assertTenantId(organizationId);
    const subsidy = await this.requireSubsidy(organizationId, id);
    const releases = await this.releasesRepo.listBySubsidy(id, organizationId);
    return { subsidy, releases };
  }

  async listByOrg(
    organizationId: TenantId,
    options: ListSubsidiesOptions = {},
  ): Promise<ReadonlyArray<SubsidyEntity>> {
    assertTenantId(organizationId);
    return this.subsidiesRepo.listByOrganization(organizationId, {
      status: options.status,
      assetId: options.assetId,
    });
  }

  // ─── Create ─────────────────────────────────────────────────────────

  /**
   * Crée une subvention active + pose l'écriture d'octroi.
   *
   *   D `grantDebitAccount` (4494 par défaut)  | totalAmount
   *   C 1411 (subvention d'investissement)     | totalAmount
   */
  async create(
    organizationId: TenantId,
    dto: CreateSubsidyDto,
    createdBy: string,
    ctx: AuditContext,
  ): Promise<SubsidyEntity> {
    assertTenantId(organizationId);
    this.assertPositiveAmount(dto.totalAmount, 'totalAmount');

    const debitAccount = dto.grantDebitAccount ?? DEFAULT_GRANT_DEBIT_ACCOUNT;
    const journalCode = dto.journalCode ?? DEFAULT_JOURNAL_CODE;

    const subsidy = await this.subsidiesRepo.create({
      organizationId,
      assetId: dto.assetId ?? null,
      grantorName: dto.grantorName,
      grantDate: dto.grantDate,
      totalAmount: this.normalizeAmount(dto.totalAmount),
      releaseMethod: dto.releaseMethod,
      note: dto.note ?? null,
      createdById: createdBy,
    });

    const entry = await this.entriesService.createDraft(
      organizationId,
      this.buildEntryInput({
        journalCode,
        entryDate: dto.grantDate,
        description: `Octroi subvention ${dto.grantorName}`,
        debitAccount,
        creditAccount: SUBSIDY_GRANT_LIABILITY_ACCOUNT,
        amount: dto.totalAmount,
        note: dto.note,
      }),
      createdBy,
      ctx,
    );

    const persisted = await this.subsidiesRepo.update(subsidy.id, organizationId, {
      journalEntryIdGrant: entry.id,
    });

    this.logger.log(
      `Subsidy ${subsidy.id} created — grantor=${dto.grantorName} amount=${dto.totalAmount}`,
    );
    return persisted;
  }

  // ─── Releases ───────────────────────────────────────────────────────

  /**
   * Reprise libre — réservée à `releaseMethod === 'manual'`.
   * Pose D 1411 / C 799 du montant `amount` et persiste la ligne
   * `subsidy_releases`. Si `releasedAmount + amount === totalAmount`,
   * bascule `status='fully_released'`.
   */
  async releaseManual(
    organizationId: TenantId,
    subsidyId: string,
    dto: ReleaseSubsidyDto,
    createdBy: string,
    ctx: AuditContext,
  ): Promise<SubsidyReleaseEntity> {
    assertTenantId(organizationId);
    this.assertPositiveAmount(dto.amount, 'amount');

    const subsidy = await this.requireSubsidy(organizationId, subsidyId);
    this.assertActive(subsidy);
    if (subsidy.releaseMethod !== 'manual') {
      throw new AppException(ERROR_CODES.SUBSIDY_INVALID_AMOUNT, {
        message: `Subsidy ${subsidyId} uses method '${subsidy.releaseMethod}' — releaseManual is only valid for 'manual'.`,
      });
    }

    return this.applyRelease(
      organizationId,
      subsidy,
      dto.amount,
      dto.releaseDate,
      createdBy,
      ctx,
      {
        journalCode: dto.journalCode ?? DEFAULT_JOURNAL_CODE,
        note: dto.note,
        relatedDepreciationScheduleId: null,
      },
    );
  }

  /**
   * Reprise proportionnelle à une dotation d'amortissement postée
   * (méthode `on_depreciation`). Formule :
   *
   *   repriseSubv = totalAmount × (dotation / assetAcquisitionCost)
   *
   * Plafonné automatiquement au montant restant pour éviter l'arrondi
   * cumulatif qui ferait dépasser le total. La dotation est lue depuis
   * `depreciation_schedules` (tenant-scoped).
   */
  async releaseOnDepreciation(
    organizationId: TenantId,
    subsidyId: string,
    depreciationScheduleId: string,
    createdBy: string,
    ctx: AuditContext,
  ): Promise<SubsidyReleaseEntity> {
    assertTenantId(organizationId);
    const subsidy = await this.requireSubsidy(organizationId, subsidyId);
    this.assertActive(subsidy);
    if (subsidy.releaseMethod !== 'on_depreciation') {
      throw new AppException(ERROR_CODES.SUBSIDY_INVALID_AMOUNT, {
        message: `Subsidy ${subsidyId} uses method '${subsidy.releaseMethod}' — releaseOnDepreciation only valid for 'on_depreciation'.`,
      });
    }
    if (!subsidy.assetId) {
      throw new AppException(ERROR_CODES.SUBSIDY_INVALID_AMOUNT, {
        message: `Subsidy ${subsidyId} has no linked asset — releaseOnDepreciation requires an asset.`,
      });
    }

    const schedule = await this.schedulesRepo.findById(depreciationScheduleId, organizationId);
    if (!schedule) {
      throw new AppException(ERROR_CODES.DEPRECIATION_SCHEDULE_NOT_FOUND, {
        message: `Depreciation schedule '${depreciationScheduleId}' not found in this organization.`,
      });
    }
    if (schedule.assetId !== subsidy.assetId) {
      throw new AppException(ERROR_CODES.SUBSIDY_INVALID_AMOUNT, {
        message: `Schedule ${depreciationScheduleId} belongs to a different asset (${schedule.assetId}) than the subsidy's asset (${subsidy.assetId}).`,
      });
    }

    // Pour le calcul, on lit le coût d'acquisition via l'asset attaché au
    // schedule. Pour ne pas dépendre d'un repository supplémentaire, on
    // recompute depuis la dotation : ratio = depreciationAmount / cost.
    // On a besoin du cost — on le lit via la subsidy.asset si chargé,
    // sinon via le schedule.asset. Comme aucun des deux n'est garanti
    // chargé, on demande le repository assets dans un appel séparé.
    // Pour rester léger, on utilise le ratio implicite : la subvention
    // suit la dotation au prorata du cumul, qui est connu via le
    // schedule (cumulativeDepreciation / (cumulativeDepreciation +
    // netBookValue) ≈ ratio amorti — mais ce serait incorrect en
    // présence d'une valeur résiduelle). On préfère lire le cost.
    //
    // → On expose une responsabilité minimale ici : le caller fournit
    // un schedule, et le ratio est calculé via depreciationAmount /
    // (cumulativeDepreciation + netBookValue + residual...). On part
    // sur l'approximation la plus simple et robuste : le ratio est
    // depreciationAmount / acquisitionCostFromSchedule, où
    // acquisitionCostFromSchedule = cumulativeDepreciation + netBookValue.
    // Cette formule reste exacte si residualValue = 0 ; en présence
    // d'une valeur résiduelle, elle reste cohérente avec la base
    // amortissable (App. 66 ne précise pas le traitement de la valeur
    // résiduelle pour la quote-part de subvention).
    const dotation = Number(schedule.depreciationAmount);
    const baseAmortissable =
      Number(schedule.cumulativeDepreciation) + Number(schedule.netBookValue);
    if (!Number.isFinite(dotation) || dotation <= 0 || baseAmortissable <= 0) {
      throw new AppException(ERROR_CODES.SUBSIDY_INVALID_AMOUNT, {
        message: `Cannot derive release amount from schedule ${depreciationScheduleId}: depreciation=${dotation}, base=${baseAmortissable}.`,
      });
    }
    const totalAmount = Number(subsidy.totalAmount);
    const releasedSoFar = Number(subsidy.releasedAmount);
    const remaining = this.round2(totalAmount - releasedSoFar);
    const rawShare = this.round2((totalAmount * dotation) / baseAmortissable);
    // Plafonnement automatique : le dernier exercice peut être légèrement
    // ajusté pour absorber l'arrondi cumulatif et atteindre exactement
    // `totalAmount`.
    const amount = rawShare > remaining ? remaining : rawShare;

    if (amount <= EPSILON) {
      throw new AppException(ERROR_CODES.SUBSIDY_OVERRELEASE, {
        message: `Subsidy ${subsidyId} has no remaining amount to release (released=${releasedSoFar.toFixed(2)}, total=${totalAmount.toFixed(2)}).`,
      });
    }

    return this.applyRelease(
      organizationId,
      subsidy,
      amount.toFixed(2),
      schedule.periodEnd,
      createdBy,
      ctx,
      {
        journalCode: DEFAULT_JOURNAL_CODE,
        note: `Reprise quote-part subvention sur dotation ${schedule.fiscalYear}`,
        relatedDepreciationScheduleId: schedule.id,
      },
    );
  }

  /**
   * Reprise mensuelle linéaire — méthode `linear_10y`.
   * `month` est une date dans le mois ciblé ; on pose la reprise au
   * dernier jour du mois (convention SYSCOHADA App. 66). Montant fixe
   * = totalAmount / 120, sauf dernier mois où on absorbe l'arrondi.
   */
  async releaseLinearMonthly(
    organizationId: TenantId,
    subsidyId: string,
    month: string,
    createdBy: string,
    ctx: AuditContext,
  ): Promise<SubsidyReleaseEntity> {
    assertTenantId(organizationId);
    const subsidy = await this.requireSubsidy(organizationId, subsidyId);
    this.assertActive(subsidy);
    if (subsidy.releaseMethod !== 'linear_10y') {
      throw new AppException(ERROR_CODES.SUBSIDY_INVALID_AMOUNT, {
        message: `Subsidy ${subsidyId} uses method '${subsidy.releaseMethod}' — releaseLinearMonthly only valid for 'linear_10y'.`,
      });
    }

    const totalAmount = Number(subsidy.totalAmount);
    const releasedSoFar = Number(subsidy.releasedAmount);
    const remaining = this.round2(totalAmount - releasedSoFar);
    const monthly = this.round2(totalAmount / LINEAR_RELEASE_MONTHS);
    const amount = monthly > remaining ? remaining : monthly;

    if (amount <= EPSILON) {
      throw new AppException(ERROR_CODES.SUBSIDY_OVERRELEASE, {
        message: `Subsidy ${subsidyId} has no remaining amount to release.`,
      });
    }

    const releaseDate = this.endOfMonth(month);

    return this.applyRelease(
      organizationId,
      subsidy,
      amount.toFixed(2),
      releaseDate,
      createdBy,
      ctx,
      {
        journalCode: DEFAULT_JOURNAL_CODE,
        note: `Reprise mensuelle linéaire subvention`,
        relatedDepreciationScheduleId: null,
      },
    );
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Annule une subvention. Refusée si elle a déjà fait l'objet d'une
   * reprise (`releasedAmount > 0`) — il faut alors contre-passer
   * d'abord les écritures via le module Journals.
   */
  async cancel(
    organizationId: TenantId,
    subsidyId: string,
    _actorId: string,
  ): Promise<SubsidyEntity> {
    assertTenantId(organizationId);
    const subsidy = await this.requireSubsidy(organizationId, subsidyId);
    if (subsidy.status !== 'active') {
      throw new AppException(ERROR_CODES.SUBSIDY_NOT_ACTIVE, {
        message: `Subsidy ${subsidyId} is not active (status=${subsidy.status}).`,
      });
    }
    if (Number(subsidy.releasedAmount) > EPSILON) {
      throw new AppException(ERROR_CODES.SUBSIDY_NOT_ACTIVE, {
        message: `Subsidy ${subsidyId} already has releases — reverse them before cancelling.`,
      });
    }
    return this.subsidiesRepo.update(subsidyId, organizationId, {
      status: 'cancelled',
      closedAt: new Date(),
    });
  }

  // ─── Internal helpers ───────────────────────────────────────────────

  /**
   * Pose l'écriture comptable de reprise + persiste la ligne
   * `subsidy_releases` + met à jour `releasedAmount`/`status`.
   * Vérifie le plafond `total − released` (SUBSIDY_OVERRELEASE).
   */
  private async applyRelease(
    organizationId: TenantId,
    subsidy: SubsidyEntity,
    amount: string,
    releaseDate: string,
    createdBy: string,
    ctx: AuditContext,
    opts: {
      journalCode: string;
      note?: string | null;
      relatedDepreciationScheduleId: string | null;
    },
  ): Promise<SubsidyReleaseEntity> {
    const total = Number(subsidy.totalAmount);
    const released = Number(subsidy.releasedAmount);
    const requested = Number(amount);
    const remaining = total - released;
    if (requested > remaining + EPSILON) {
      throw new AppException(ERROR_CODES.SUBSIDY_OVERRELEASE, {
        message: `Release ${requested.toFixed(2)} exceeds remaining ${remaining.toFixed(2)} (total=${total.toFixed(2)}, released=${released.toFixed(2)}).`,
        details: { requested, remaining, total, released },
      });
    }

    const entry = await this.entriesService.createDraft(
      organizationId,
      this.buildEntryInput({
        journalCode: opts.journalCode,
        entryDate: releaseDate,
        description: `Reprise subvention ${subsidy.grantorName}`,
        debitAccount: SUBSIDY_GRANT_LIABILITY_ACCOUNT,
        creditAccount: SUBSIDY_RELEASE_INCOME_ACCOUNT,
        amount,
        note: opts.note ?? undefined,
      }),
      createdBy,
      ctx,
    );

    const release = await this.releasesRepo.create({
      subsidyId: subsidy.id,
      organizationId,
      releaseDate,
      amount: this.normalizeAmount(amount),
      journalEntryId: entry.id,
      relatedDepreciationScheduleId: opts.relatedDepreciationScheduleId,
      createdById: createdBy,
    });

    const newReleased = this.round2(released + requested);
    const fullyReleased = newReleased >= total - EPSILON;
    await this.subsidiesRepo.update(subsidy.id, organizationId, {
      releasedAmount: newReleased.toFixed(2),
      status: fullyReleased ? 'fully_released' : 'active',
      closedAt: fullyReleased ? new Date() : null,
    });

    return release;
  }

  private async requireSubsidy(
    organizationId: TenantId,
    id: string,
  ): Promise<SubsidyEntity> {
    const subsidy = await this.subsidiesRepo.findById(id, organizationId);
    if (!subsidy) {
      throw new AppException(ERROR_CODES.SUBSIDY_NOT_FOUND, {
        message: `Subsidy '${id}' not found in this organization.`,
      });
    }
    return subsidy;
  }

  private assertActive(subsidy: SubsidyEntity): void {
    if (subsidy.status !== 'active') {
      throw new AppException(ERROR_CODES.SUBSIDY_NOT_ACTIVE, {
        message: `Subsidy '${subsidy.id}' is not active (status=${subsidy.status}).`,
      });
    }
  }

  private assertPositiveAmount(amount: string, field: string): void {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      throw new AppException(ERROR_CODES.SUBSIDY_INVALID_AMOUNT, {
        message: `${field} must be a positive number, got '${amount}'.`,
      });
    }
  }

  private normalizeAmount(amount: string): string {
    return Number(amount).toFixed(2);
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /** Convertit une date YYYY-MM-DD en dernier jour du mois (YYYY-MM-31|30|29|28). */
  private endOfMonth(isoDate: string): string {
    const [yearStr, monthStr] = isoDate.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      throw new AppException(ERROR_CODES.SUBSIDY_INVALID_AMOUNT, {
        message: `Invalid month '${isoDate}': expected YYYY-MM-DD.`,
      });
    }
    // Day 0 du mois suivant = dernier jour du mois courant (UTC).
    const last = new Date(Date.UTC(year, month, 0));
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${last.getUTCFullYear()}-${pad(last.getUTCMonth() + 1)}-${pad(last.getUTCDate())}`;
  }

  private buildEntryInput(params: {
    readonly journalCode: string;
    readonly entryDate: string;
    readonly description: string;
    readonly debitAccount: string;
    readonly creditAccount: string;
    readonly amount: string;
    readonly note?: string;
  }): {
    journalCode: string;
    entryDate: string;
    description: string;
    lines: CreateLineInput[];
  } {
    const value = Number(params.amount);
    const lines: CreateLineInput[] = [
      {
        accountCode: params.debitAccount,
        debit: value,
        credit: 0,
        description: params.note ?? null,
      },
      {
        accountCode: params.creditAccount,
        debit: 0,
        credit: value,
        description: params.note ?? null,
      },
    ];
    return {
      journalCode: params.journalCode,
      entryDate: params.entryDate,
      description: params.description,
      lines,
    };
  }
}
