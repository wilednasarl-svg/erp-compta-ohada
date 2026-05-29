import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import { EntriesService, type CreateLineInput } from '../../journals/services/entries.service';
import { CreateProvisionDto } from '../dto/create-provision.dto';
import { ProvisionEntity } from '../entities/provision.entity';
import { ProvisionMovementEntity } from '../entities/provision-movement.entity';
import { ProvisionMovementsRepository } from '../repositories/provision-movements.repository';
import { ProvisionsRepository } from '../repositories/provisions.repository';
import {
  resolveDotationAccount,
  resolveProvisionAccount,
  resolveRepriseAccount,
  type ProvisionStatus,
  type ProvisionType,
} from '../types/provision.types';

/**
 * Filtres acceptes par `listByOrg`. Reproduit la forme attendue par les
 * controllers/services consommateurs (vague 2). `limit` et `offset`
 * sont conserves pour autoriser une pagination simple sans changer la
 * signature du repository (`listByOrganization` ne filtre que par
 * status/type aujourd hui).
 */
export interface ListProvisionsOptions {
  readonly status?: ProvisionStatus;
  readonly type?: ProvisionType;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Vue agregee retournee par `findById` : la provision + son journal de
 * mouvements (ordre antechronologique). Le shape reste minimal — les
 * controllers wave 2 mapperont vers leur propre DTO REST.
 */
export interface ProvisionWithMovements {
  readonly provision: ProvisionEntity;
  readonly movements: ReadonlyArray<ProvisionMovementEntity>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Code journal par defaut pour les dotations / reprises de provisions.
 * `OD` (operations diverses) est seede par OrganizationsService pour
 * toute organisation SYSCOHADA — voir JournalsModule wave 1.
 */
const DEFAULT_JOURNAL_CODE = 'OD';

/**
 * W3.1 — Service applicatif des provisions pour risques et charges.
 *
 * Responsabilites :
 *   - creer / consulter / lister les provisions tenant-scope
 *   - appliquer les trois operations metier (`dotation`, `reprise`,
 *     `utilization`) en garantissant la coherence solde / statut
 *   - generer l ecriture comptable double partie associee (sauf
 *     `utilization` qui est volontairement neutre comptablement —
 *     l operation est posee par un autre module au moment du paiement)
 *
 * Conventions :
 *   - montants `string` decimal (NUMERIC 15,2 cote DB)
 *   - solde `currentAmount` ne peut jamais devenir negatif (CHECK DB +
 *     garde applicatif `PROVISION_INSUFFICIENT_BALANCE`)
 *   - aucune mutation in-place : on lit, on calcule, on persiste un
 *     patch via le repository
 */
@Injectable()
export class ProvisionsService {
  private readonly logger = new Logger(ProvisionsService.name);

  constructor(
    private readonly provisionsRepo: ProvisionsRepository,
    private readonly movementsRepo: ProvisionMovementsRepository,
    private readonly entriesService: EntriesService,
  ) {}

  // ─── Queries ────────────────────────────────────────────────────────

  async findById(organizationId: TenantId, id: string): Promise<ProvisionWithMovements> {
    assertTenantId(organizationId);
    const provision = await this.requireProvision(organizationId, id);
    const movements = await this.movementsRepo.listByProvision(id, organizationId);
    return { provision, movements };
  }

  async listByOrg(
    organizationId: TenantId,
    options: ListProvisionsOptions = {},
  ): Promise<ReadonlyArray<ProvisionEntity>> {
    assertTenantId(organizationId);
    const all = await this.provisionsRepo.listByOrganization(organizationId, {
      status: options.status,
      type: options.type,
    });
    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.min(MAX_LIMIT, Math.max(1, options.limit ?? DEFAULT_LIMIT));
    return all.slice(offset, offset + limit);
  }

  // ─── Create ─────────────────────────────────────────────────────────

  /**
   * Cree une provision active + son mouvement initial `dotation` et pose
   * l ecriture comptable D 691x|697x / C 19x via `EntriesService`.
   */
  async create(
    organizationId: TenantId,
    dto: CreateProvisionDto,
    actorId: string,
    ctx: AuditContext,
  ): Promise<ProvisionEntity> {
    assertTenantId(organizationId);
    this.assertPositiveAmount(dto.initialAmount);

    const accountCode = resolveProvisionAccount(dto.type);
    const dotationAccount = resolveDotationAccount(dto.type);
    const journalCode = dto.journalCode ?? DEFAULT_JOURNAL_CODE;

    const provision = await this.provisionsRepo.create({
      organizationId,
      type: dto.type,
      accountCode,
      label: dto.label,
      initialAmount: dto.initialAmount,
      currentAmount: dto.initialAmount,
      status: 'active',
      createdById: actorId,
    });

    const entry = await this.entriesService.createDraft(
      organizationId,
      this.buildEntryInput({
        journalCode,
        entryDate: dto.effectiveDate,
        description: `Dotation provision ${provision.label}`,
        debitAccount: dotationAccount,
        creditAccount: accountCode,
        amount: dto.initialAmount,
        note: dto.note,
      }),
      actorId,
      ctx,
    );

    await this.movementsRepo.create({
      provisionId: provision.id,
      organizationId,
      kind: 'dotation',
      amount: dto.initialAmount,
      journalEntryId: entry.id,
      effectiveDate: dto.effectiveDate,
      note: dto.note ?? null,
      createdById: actorId,
    });

    this.logger.log(
      `Provision ${provision.id} created — type=${dto.type} amount=${dto.initialAmount}`,
    );
    return provision;
  }

  // ─── Operations metier ──────────────────────────────────────────────

  async dotation(
    organizationId: TenantId,
    provisionId: string,
    amount: string,
    effectiveDate: string,
    actorId: string,
    ctx: AuditContext,
    note?: string,
  ): Promise<ProvisionEntity> {
    assertTenantId(organizationId);
    this.assertPositiveAmount(amount);

    const provision = await this.requireProvision(organizationId, provisionId);
    this.assertActive(provision);

    const newAmount = this.add(provision.currentAmount, amount);
    const dotationAccount = resolveDotationAccount(provision.type);

    const entry = await this.entriesService.createDraft(
      organizationId,
      this.buildEntryInput({
        journalCode: DEFAULT_JOURNAL_CODE,
        entryDate: effectiveDate,
        description: `Dotation complementaire ${provision.label}`,
        debitAccount: dotationAccount,
        creditAccount: provision.accountCode,
        amount,
        note,
      }),
      actorId,
      ctx,
    );

    const updated = await this.provisionsRepo.update(provisionId, organizationId, {
      currentAmount: newAmount,
    });

    await this.movementsRepo.create({
      provisionId,
      organizationId,
      kind: 'dotation',
      amount,
      journalEntryId: entry.id,
      effectiveDate,
      note: note ?? null,
      createdById: actorId,
    });

    return updated;
  }

  async reprise(
    organizationId: TenantId,
    provisionId: string,
    amount: string,
    effectiveDate: string,
    actorId: string,
    ctx: AuditContext,
    note?: string,
  ): Promise<ProvisionEntity> {
    assertTenantId(organizationId);
    this.assertPositiveAmount(amount);

    const provision = await this.requireProvision(organizationId, provisionId);
    this.assertActive(provision);
    this.assertSufficientBalance(provision, amount);

    const newAmount = this.sub(provision.currentAmount, amount);
    const closed = this.isZero(newAmount);
    const repriseAccount = resolveRepriseAccount(provision.type);

    const entry = await this.entriesService.createDraft(
      organizationId,
      this.buildEntryInput({
        journalCode: DEFAULT_JOURNAL_CODE,
        entryDate: effectiveDate,
        description: `Reprise provision ${provision.label}`,
        debitAccount: provision.accountCode,
        creditAccount: repriseAccount,
        amount,
        note,
      }),
      actorId,
      ctx,
    );

    const updated = await this.provisionsRepo.update(provisionId, organizationId, {
      currentAmount: newAmount,
      status: closed ? 'closed' : 'active',
      closedAt: closed ? new Date() : null,
      closedById: closed ? actorId : null,
    });

    await this.movementsRepo.create({
      provisionId,
      organizationId,
      kind: 'reprise',
      amount,
      journalEntryId: entry.id,
      effectiveDate,
      note: note ?? null,
      createdById: actorId,
    });

    return updated;
  }

  /**
   * Diminue le solde sans poser d ecriture : la charge reelle est
   * comptabilisee ailleurs (ex. paiement du litige par le module
   * banque). Le mouvement est trace pour audit.
   */
  async utilization(
    organizationId: TenantId,
    provisionId: string,
    amount: string,
    effectiveDate: string,
    actorId: string,
    note?: string,
  ): Promise<ProvisionEntity> {
    assertTenantId(organizationId);
    this.assertPositiveAmount(amount);

    const provision = await this.requireProvision(organizationId, provisionId);
    this.assertActive(provision);
    this.assertSufficientBalance(provision, amount);

    const newAmount = this.sub(provision.currentAmount, amount);
    const closed = this.isZero(newAmount);

    const updated = await this.provisionsRepo.update(provisionId, organizationId, {
      currentAmount: newAmount,
      status: closed ? 'closed' : 'active',
      closedAt: closed ? new Date() : null,
      closedById: closed ? actorId : null,
    });

    await this.movementsRepo.create({
      provisionId,
      organizationId,
      kind: 'utilization',
      amount,
      journalEntryId: null,
      effectiveDate,
      note: note ?? null,
      createdById: actorId,
    });

    return updated;
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async requireProvision(organizationId: TenantId, id: string): Promise<ProvisionEntity> {
    const provision = await this.provisionsRepo.findById(id, organizationId);
    if (!provision) {
      throw new AppException(ERROR_CODES.PROVISION_NOT_FOUND, {
        message: `Provision '${id}' not found in this organization.`,
      });
    }
    return provision;
  }

  private assertPositiveAmount(amount: string): void {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      throw new AppException(ERROR_CODES.PROVISION_INVALID_AMOUNT, {
        message: `Provision amount must be a positive number, got '${amount}'.`,
      });
    }
  }

  private assertActive(provision: ProvisionEntity): void {
    if (provision.status !== 'active') {
      throw new AppException(ERROR_CODES.PROVISION_NOT_ACTIVE, {
        message: `Provision '${provision.id}' is not active (status=${provision.status}).`,
      });
    }
  }

  private assertSufficientBalance(provision: ProvisionEntity, amount: string): void {
    const current = Number(provision.currentAmount);
    const requested = Number(amount);
    if (requested > current + 1e-9) {
      throw new AppException(ERROR_CODES.PROVISION_INSUFFICIENT_BALANCE, {
        message: `Insufficient balance: requested=${amount}, available=${provision.currentAmount}.`,
      });
    }
  }

  private add(a: string, b: string): string {
    return (Number(a) + Number(b)).toFixed(2);
  }

  private sub(a: string, b: string): string {
    const result = Number(a) - Number(b);
    // Garde-fou : on n autorise pas un solde negatif (le CHECK DB le
    // rejetterait de toute facon, mais on prefere un message clair).
    if (result < -1e-9) {
      throw new AppException(ERROR_CODES.PROVISION_INSUFFICIENT_BALANCE, {
        message: `Provision balance would become negative: ${a} - ${b}.`,
      });
    }
    return Math.max(0, result).toFixed(2);
  }

  private isZero(amount: string): boolean {
    return Math.abs(Number(amount)) < 0.005;
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
