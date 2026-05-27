import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { CreateActuarialCommitmentDto } from '../dto/create-commitment.dto';
import { UpdateActuarialCommitmentDto } from '../dto/update-commitment.dto';
import { ActuarialCommitmentEntity } from '../entities/actuarial-commitment.entity';
import {
  ActuarialCommitmentsRepository,
  type ListActuarialCommitmentsFilters,
} from '../repositories/actuarial-commitments.repository';
import type {
  ActuarialCommitmentSnapshot,
  ActuarialCommitmentType,
} from '../types/actuarial-commitment.types';

/** Tolérance décimale NUMERIC(15,2). */
const EPSILON = 0.005;

/**
 * E2 — Service applicatif des engagements actuariels retraite &
 * avantages au personnel (Tome 3 N16B + Tome 2 chap. 21).
 *
 * Responsabilités :
 *   - création + lecture + patch + expiration d'une évaluation
 *     actuarielle (DAP = dette actuarielle projetée)
 *   - dérivation du « hors-bilan » = obligation − provisioned
 *   - garde-fou ACTUARIAL_COMMITMENT_PROVISION_OVERFLOW
 *
 * Aucun controller en wave 1 — la consommation se fait via le handler
 * N16B des Notes annexes (DI directe, lecture seule).
 */
@Injectable()
export class ActuarialCommitmentsService {
  private readonly logger = new Logger(ActuarialCommitmentsService.name);

  constructor(private readonly repo: ActuarialCommitmentsRepository) {}

  // ─── Create / update / expire ───────────────────────────────────────

  async create(
    organizationId: TenantId,
    dto: CreateActuarialCommitmentDto,
    createdBy: string | null,
  ): Promise<ActuarialCommitmentEntity> {
    assertTenantId(organizationId);
    this.assertNonNegative(dto.obligationAmount, 'obligationAmount');
    const provisioned = dto.provisionedAmount ?? '0.00';
    this.assertNonNegative(provisioned, 'provisionedAmount');
    this.assertProvisionWithinObligation(dto.obligationAmount, provisioned);

    const entity = await this.repo.create({
      organizationId,
      commitmentType: dto.commitmentType,
      label: dto.label,
      valuationDate: dto.valuationDate,
      obligationAmount: this.normalizeAmount(dto.obligationAmount),
      provisionedAmount: this.normalizeAmount(provisioned),
      discountRate: dto.discountRate,
      mortalityTable: dto.mortalityTable,
      staffTurnover: dto.staffTurnover ?? null,
      salaryGrowthRate: dto.salaryGrowthRate ?? null,
      methodology: dto.methodology,
      actuaryName: dto.actuaryName ?? null,
      comment: dto.comment ?? null,
      createdById: createdBy,
    });

    this.logger.log(
      `ActuarialCommitment ${entity.id} created — type=${dto.commitmentType} obligation=${dto.obligationAmount}`,
    );
    return entity;
  }

  async update(
    organizationId: TenantId,
    id: string,
    dto: UpdateActuarialCommitmentDto,
  ): Promise<ActuarialCommitmentEntity> {
    assertTenantId(organizationId);
    const current = await this.requireCommitment(organizationId, id);
    this.assertActive(current);

    const nextObligation = dto.obligationAmount ?? current.obligationAmount;
    const nextProvisioned = dto.provisionedAmount ?? current.provisionedAmount;
    if (dto.obligationAmount !== undefined) {
      this.assertNonNegative(dto.obligationAmount, 'obligationAmount');
    }
    if (dto.provisionedAmount !== undefined) {
      this.assertNonNegative(dto.provisionedAmount, 'provisionedAmount');
    }
    this.assertProvisionWithinObligation(nextObligation, nextProvisioned);

    return this.repo.update(id, organizationId, {
      label: dto.label,
      valuationDate: dto.valuationDate,
      obligationAmount:
        dto.obligationAmount !== undefined
          ? this.normalizeAmount(dto.obligationAmount)
          : undefined,
      provisionedAmount:
        dto.provisionedAmount !== undefined
          ? this.normalizeAmount(dto.provisionedAmount)
          : undefined,
      discountRate: dto.discountRate,
      mortalityTable: dto.mortalityTable,
      staffTurnover: dto.staffTurnover,
      salaryGrowthRate: dto.salaryGrowthRate,
      methodology: dto.methodology,
      actuaryName: dto.actuaryName,
      comment: dto.comment,
    });
  }

  /**
   * Marque une évaluation comme expirée — elle reste consultable mais
   * n'est plus consommée par le handler N16B ni par
   * `sumOffBalanceSheetAsOf`.
   */
  async expire(
    organizationId: TenantId,
    id: string,
  ): Promise<ActuarialCommitmentEntity> {
    assertTenantId(organizationId);
    const current = await this.requireCommitment(organizationId, id);
    if (current.status !== 'active') {
      throw new AppException(ERROR_CODES.ACTUARIAL_COMMITMENT_NOT_ACTIVE, {
        message: `ActuarialCommitment '${id}' is not active (status=${current.status}).`,
      });
    }
    return this.repo.update(id, organizationId, { status: 'expired' });
  }

  // ─── Reads ──────────────────────────────────────────────────────────

  async findById(organizationId: TenantId, id: string): Promise<ActuarialCommitmentEntity> {
    assertTenantId(organizationId);
    return this.requireCommitment(organizationId, id);
  }

  async listByOrg(
    organizationId: TenantId,
    filters: ListActuarialCommitmentsFilters = {},
  ): Promise<ReadonlyArray<ActuarialCommitmentEntity>> {
    assertTenantId(organizationId);
    return this.repo.listByOrganization(organizationId, filters);
  }

  /**
   * Renvoie la dernière évaluation active pour un type donné — utilisé
   * par le handler N16B pour ne pas additionner deux évaluations
   * successives du même type.
   */
  async getLatestByType(
    organizationId: TenantId,
    commitmentType: ActuarialCommitmentType,
  ): Promise<ActuarialCommitmentEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findLatestActiveByType(organizationId, commitmentType);
  }

  /**
   * Somme des engagements hors-bilan (obligation − provisioned) pour
   * toutes les évaluations actives à `asAtDate`. Renvoie une string
   * NUMERIC(15,2) "0.00".
   */
  async sumOffBalanceSheetAsOf(
    organizationId: TenantId,
    asAtDate: string,
  ): Promise<string> {
    assertTenantId(organizationId);
    const rows = await this.repo.listActiveAsOf(organizationId, asAtDate);
    const total = rows.reduce((acc, row) => {
      const obligation = Number(row.obligationAmount);
      const provisioned = Number(row.provisionedAmount);
      return acc + Math.max(0, obligation - provisioned);
    }, 0);
    return total.toFixed(2);
  }

  /**
   * Mappe une entité TypeORM vers le snapshot stable consommé par le
   * handler N16B (decoupling : pas d'import de l'entité côté moteur).
   */
  toSnapshot(entity: ActuarialCommitmentEntity): ActuarialCommitmentSnapshot {
    const obligation = Number(entity.obligationAmount);
    const provisioned = Number(entity.provisionedAmount);
    const hb = Math.max(0, obligation - provisioned);
    return {
      id: entity.id,
      commitmentType: entity.commitmentType,
      label: entity.label,
      valuationDate: entity.valuationDate,
      obligationAmount: this.normalizeAmount(entity.obligationAmount),
      provisionedAmount: this.normalizeAmount(entity.provisionedAmount),
      offBalanceSheetAmount: hb.toFixed(2),
      discountRate: entity.discountRate,
      mortalityTable: entity.mortalityTable,
      actuaryName: entity.actuaryName,
      status: entity.status,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async requireCommitment(
    organizationId: TenantId,
    id: string,
  ): Promise<ActuarialCommitmentEntity> {
    const row = await this.repo.findById(id, organizationId);
    if (!row) {
      throw new AppException(ERROR_CODES.ACTUARIAL_COMMITMENT_NOT_FOUND, {
        message: `ActuarialCommitment '${id}' not found in this organization.`,
      });
    }
    return row;
  }

  private assertActive(entity: ActuarialCommitmentEntity): void {
    if (entity.status !== 'active') {
      throw new AppException(ERROR_CODES.ACTUARIAL_COMMITMENT_NOT_ACTIVE, {
        message: `ActuarialCommitment '${entity.id}' is not active (status=${entity.status}).`,
      });
    }
  }

  private assertNonNegative(amount: string, field: string): void {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      throw new AppException(ERROR_CODES.ACTUARIAL_COMMITMENT_PROVISION_OVERFLOW, {
        message: `${field} must be a non-negative number, got '${amount}'.`,
      });
    }
  }

  private assertProvisionWithinObligation(obligation: string, provisioned: string): void {
    const o = Number(obligation);
    const p = Number(provisioned);
    if (!Number.isFinite(o) || !Number.isFinite(p)) {
      throw new AppException(ERROR_CODES.ACTUARIAL_COMMITMENT_PROVISION_OVERFLOW, {
        message: `Invalid amounts: obligation='${obligation}', provisioned='${provisioned}'.`,
      });
    }
    if (p > o + EPSILON) {
      throw new AppException(ERROR_CODES.ACTUARIAL_COMMITMENT_PROVISION_OVERFLOW, {
        message: `provisionedAmount (${p.toFixed(2)}) must not exceed obligationAmount (${o.toFixed(2)}).`,
        details: { obligationAmount: o, provisionedAmount: p },
      });
    }
  }

  private normalizeAmount(amount: string): string {
    return Number(amount).toFixed(2);
  }
}
