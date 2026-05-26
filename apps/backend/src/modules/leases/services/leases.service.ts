import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import { EntriesService, type CreateLineInput } from '../../journals/services/entries.service';
import { CreateLeaseDto } from '../dto/create-lease.dto';
import { LeaseEntity } from '../entities/lease.entity';
import { LeaseInstallmentEntity } from '../entities/lease-installment.entity';
import { LeasePaymentEntity } from '../entities/lease-payment.entity';
import { LeaseInstallmentsRepository } from '../repositories/lease-installments.repository';
import { LeasePaymentsRepository } from '../repositories/lease-payments.repository';
import { LeasesRepository } from '../repositories/leases.repository';
import {
  buildAmortizationSchedule,
  findImplicitRate,
} from './implicit-rate-calculator';
import {
  LEASE_ACCOUNTS,
  LEASE_DEFAULT_JOURNAL_CODE,
  type LeaseStatus,
  periodsPerYear,
} from '../types/lease.types';

/**
 * Vue agrégée retournée par `findById`.
 */
export interface LeaseWithDetails {
  readonly lease: LeaseEntity;
  readonly installments: ReadonlyArray<LeaseInstallmentEntity>;
  readonly payments: ReadonlyArray<LeasePaymentEntity>;
}

export interface ListLeasesOptions {
  readonly status?: LeaseStatus;
  readonly assetId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface CreateLeaseResult {
  readonly lease: LeaseEntity;
  readonly installments: ReadonlyArray<LeaseInstallmentEntity>;
}

export interface PayInstallmentResult {
  readonly payment: LeasePaymentEntity;
  readonly installment: LeaseInstallmentEntity;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * W4.5 — Service applicatif du module crédit-bail.
 *
 * Responsabilités :
 *   - créer un contrat de crédit-bail / location-acquisition :
 *     - calculer le taux implicite par bisection
 *     - construire le tableau d'amortissement
 *     - persister les N échéances
 *     - poser l'écriture initiale D 2411 / C 173 (juste valeur)
 *   - traiter le paiement d'une échéance :
 *     - poser l'écriture D 6724 + D 173 / C 521
 *     - marquer l'échéance comme payée
 *   - consulter / lister / annuler
 *
 * Conventions :
 *   - montants `string` decimal (NUMERIC 15,2 côté DB) — les calculs
 *     internes utilisent `number` puis on re-sérialise via `.toFixed(2)`
 *   - aucune mutation in-place : on lit, on calcule, on persiste un patch
 */
@Injectable()
export class LeasesService {
  private readonly logger = new Logger(LeasesService.name);

  constructor(
    private readonly leasesRepo: LeasesRepository,
    private readonly installmentsRepo: LeaseInstallmentsRepository,
    private readonly paymentsRepo: LeasePaymentsRepository,
    private readonly entriesService: EntriesService,
  ) {}

  // ─── Queries ────────────────────────────────────────────────────────

  async findById(
    organizationId: TenantId,
    id: string,
  ): Promise<LeaseWithDetails> {
    assertTenantId(organizationId);
    const lease = await this.requireLease(organizationId, id);
    const [installments, payments] = await Promise.all([
      this.installmentsRepo.listByLease(id, organizationId),
      this.paymentsRepo.listByLease(id, organizationId),
    ]);
    return { lease, installments, payments };
  }

  async listByOrg(
    organizationId: TenantId,
    options: ListLeasesOptions = {},
  ): Promise<ReadonlyArray<LeaseEntity>> {
    assertTenantId(organizationId);
    const all = await this.leasesRepo.listByOrganization(organizationId, {
      status: options.status,
      assetId: options.assetId,
    });
    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.min(MAX_LIMIT, Math.max(1, options.limit ?? DEFAULT_LIMIT));
    return all.slice(offset, offset + limit);
  }

  // ─── Create ─────────────────────────────────────────────────────────

  /**
   * Crée un contrat de crédit-bail, calcule le taux implicite,
   * construit le tableau d'amortissement, persiste lease + N
   * installments, puis pose l'écriture initiale D 2411 / C 173.
   */
  async create(
    organizationId: TenantId,
    dto: CreateLeaseDto,
    actorId: string,
    ctx: AuditContext,
  ): Promise<CreateLeaseResult> {
    assertTenantId(organizationId);
    this.assertPositiveAmount(dto.fairValue, 'fairValue');
    this.assertPositiveAmount(dto.installmentAmount, 'installmentAmount');
    if (dto.numberOfInstallments <= 0) {
      throw new AppException(ERROR_CODES.LEASE_IMPLICIT_RATE_CALCULATION_FAILED, {
        message: `numberOfInstallments must be > 0, got ${dto.numberOfInstallments}`,
      });
    }

    const fairValue = Number(dto.fairValue);
    const installmentAmount = Number(dto.installmentAmount);
    const optionAmount = Number(dto.purchaseOptionAmount ?? '0');

    // 1. Taux implicite (annuel) par bisection.
    const annualRate = findImplicitRate(
      fairValue,
      installmentAmount,
      dto.numberOfInstallments,
      optionAmount,
      dto.frequency,
    );
    const periodicRate = annualRate / periodsPerYear(dto.frequency);

    // 2. Tableau d'amortissement.
    const schedule = buildAmortizationSchedule(
      fairValue,
      periodicRate,
      installmentAmount,
      dto.numberOfInstallments,
      optionAmount,
      dto.frequency,
      dto.startDate,
    );

    const nominalTotal = schedule.reduce((s, r) => s + r.totalAmount, 0);

    // 3. Persiste le contrat.
    const lease = await this.leasesRepo.create({
      organizationId,
      assetId: dto.assetId ?? null,
      contractRef: dto.contractRef,
      lessorName: dto.lessorName,
      startDate: dto.startDate,
      endDate: dto.endDate,
      fairValue: fairValue.toFixed(2),
      nominalTotalAmount: nominalTotal.toFixed(2),
      implicitRate: annualRate.toFixed(5),
      purchaseOptionAmount: optionAmount.toFixed(2),
      frequency: dto.frequency,
      numberOfInstallments: dto.numberOfInstallments,
      status: 'active',
      note: dto.note ?? null,
      createdById: actorId,
    });

    // 4. Persiste les échéances.
    const installments = await this.installmentsRepo.createMany(
      schedule.map((row) => ({
        leaseId: lease.id,
        organizationId,
        dueDate: row.dueDate,
        installmentNumber: row.installmentNumber,
        totalAmount: row.totalAmount.toFixed(2),
        interestPart: row.interestPart.toFixed(2),
        capitalPart: row.capitalPart.toFixed(2),
        outstandingBalance: row.outstandingBalance.toFixed(2),
      })),
    );

    // 5. Écriture initiale D 2411 / C 173 (juste valeur).
    const entry = await this.entriesService.createDraft(
      organizationId,
      this.buildEntryInput({
        journalCode: LEASE_DEFAULT_JOURNAL_CODE,
        entryDate: dto.startDate,
        description: `Prise en crédit-bail ${dto.contractRef} (${dto.lessorName})`,
        lines: [
          {
            accountCode: LEASE_ACCOUNTS.ASSET,
            debit: fairValue,
            credit: 0,
            description: dto.note ?? null,
          },
          {
            accountCode: LEASE_ACCOUNTS.DEBT,
            debit: 0,
            credit: fairValue,
            description: dto.note ?? null,
          },
        ],
      }),
      actorId,
      ctx,
    );

    const updated = await this.leasesRepo.update(lease.id, organizationId, {
      journalEntryIdInitial: entry.id,
    });

    this.logger.log(
      `Lease ${updated.id} created — annualRate=${annualRate.toFixed(5)} periods=${dto.numberOfInstallments} fairValue=${fairValue}`,
    );
    return { lease: updated, installments };
  }

  // ─── Paiement d'échéance ────────────────────────────────────────────

  /**
   * Pose l'écriture D 6724 (intérêts) + D 173 (capital) / C 521 (banque)
   * et marque l'échéance comme payée. La décomposition est figée par
   * le tableau d'amortissement — pas surchargeable par l'appelant.
   *
   * Si toutes les échéances sont payées, le statut du contrat passe
   * à `closed`.
   */
  async payInstallment(
    organizationId: TenantId,
    leaseId: string,
    installmentId: string,
    paymentDate: string,
    actorId: string,
    ctx: AuditContext,
    note?: string,
  ): Promise<PayInstallmentResult> {
    assertTenantId(organizationId);

    const lease = await this.requireLease(organizationId, leaseId);
    if (lease.status !== 'active') {
      throw new AppException(ERROR_CODES.LEASE_NOT_ACTIVE, {
        message: `Lease '${leaseId}' is not active (status=${lease.status}).`,
      });
    }

    const installment = await this.installmentsRepo.findById(installmentId, organizationId);
    if (!installment || installment.leaseId !== leaseId) {
      throw new AppException(ERROR_CODES.LEASE_INSTALLMENT_NOT_FOUND, {
        message: `Lease installment '${installmentId}' not found on lease '${leaseId}'.`,
      });
    }
    if (installment.paid) {
      throw new AppException(ERROR_CODES.LEASE_INSTALLMENT_ALREADY_PAID, {
        message: `Lease installment '${installmentId}' is already paid.`,
      });
    }

    const total = Number(installment.totalAmount);
    const interest = Number(installment.interestPart);
    const capital = Number(installment.capitalPart);

    // Écriture D 6724 intérêts + D 173 capital / C 521 banque.
    // Sur les contrats sans intérêts (rate = 0), `interest` peut être
    // 0 — on supprime alors la ligne d'intérêts pour éviter une ligne
    // débit/crédit nulle (rejetée par `createDraft`).
    const debitLines: CreateLineInput[] = [];
    if (interest > 0) {
      debitLines.push({
        accountCode: LEASE_ACCOUNTS.INTEREST_EXPENSE,
        debit: interest,
        credit: 0,
        description: note ?? null,
      });
    }
    debitLines.push({
      accountCode: LEASE_ACCOUNTS.DEBT,
      debit: capital,
      credit: 0,
      description: note ?? null,
    });
    const lines: CreateLineInput[] = [
      ...debitLines,
      {
        accountCode: LEASE_ACCOUNTS.BANK,
        debit: 0,
        credit: total,
        description: note ?? null,
      },
    ];

    const entry = await this.entriesService.createDraft(
      organizationId,
      this.buildEntryInput({
        journalCode: LEASE_DEFAULT_JOURNAL_CODE,
        entryDate: paymentDate,
        description: `Échéance ${installment.installmentNumber} crédit-bail ${lease.contractRef}`,
        lines,
      }),
      actorId,
      ctx,
    );

    const payment = await this.paymentsRepo.create({
      leaseId,
      installmentId,
      organizationId,
      paymentDate,
      amount: total.toFixed(2),
      interestPart: interest.toFixed(2),
      capitalPart: capital.toFixed(2),
      journalEntryId: entry.id,
      note: note ?? null,
      createdById: actorId,
    });

    const updatedInstallment = await this.installmentsRepo.markPaid(
      installmentId,
      organizationId,
    );

    // Si toutes les échéances sont payées, on clôt le contrat.
    const all = await this.installmentsRepo.listByLease(leaseId, organizationId);
    const allPaid = all.every((i) => i.paid);
    if (allPaid) {
      await this.leasesRepo.update(leaseId, organizationId, { status: 'closed' });
      this.logger.log(`Lease ${leaseId} fully paid — status=closed`);
    }

    return { payment, installment: updatedInstallment };
  }

  // ─── Cancel ─────────────────────────────────────────────────────────

  /**
   * Annule un contrat actif. Refusé si au moins un paiement a déjà
   * été posé : on évite de masquer des écritures comptables réelles.
   */
  async cancel(organizationId: TenantId, leaseId: string): Promise<LeaseEntity> {
    assertTenantId(organizationId);
    const lease = await this.requireLease(organizationId, leaseId);
    if (lease.status !== 'active') {
      throw new AppException(ERROR_CODES.LEASE_NOT_ACTIVE, {
        message: `Lease '${leaseId}' cannot be cancelled (status=${lease.status}).`,
      });
    }
    const payments = await this.paymentsRepo.listByLease(leaseId, organizationId);
    if (payments.length > 0) {
      throw new AppException(ERROR_CODES.LEASE_NOT_ACTIVE, {
        message: `Lease '${leaseId}' has ${payments.length} payment(s) — cannot cancel.`,
      });
    }
    return this.leasesRepo.update(leaseId, organizationId, { status: 'cancelled' });
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async requireLease(
    organizationId: TenantId,
    id: string,
  ): Promise<LeaseEntity> {
    const lease = await this.leasesRepo.findById(id, organizationId);
    if (!lease) {
      throw new AppException(ERROR_CODES.LEASE_NOT_FOUND, {
        message: `Lease '${id}' not found in this organization.`,
      });
    }
    return lease;
  }

  private assertPositiveAmount(amount: string, field: string): void {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      throw new AppException(ERROR_CODES.LEASE_IMPLICIT_RATE_CALCULATION_FAILED, {
        message: `${field} must be a positive number, got '${amount}'.`,
      });
    }
  }

  private buildEntryInput(params: {
    readonly journalCode: string;
    readonly entryDate: string;
    readonly description: string;
    readonly lines: ReadonlyArray<CreateLineInput>;
  }): {
    journalCode: string;
    entryDate: string;
    description: string;
    lines: CreateLineInput[];
  } {
    return {
      journalCode: params.journalCode,
      entryDate: params.entryDate,
      description: params.description,
      lines: [...params.lines],
    };
  }
}
