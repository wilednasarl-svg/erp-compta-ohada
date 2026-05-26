import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import { EntriesService, type CreateLineInput } from '../../journals/services/entries.service';
import { CreateBillDto } from '../dto/create-bill.dto';
import { DiscountBillDto } from '../dto/discount-bill.dto';
import { SettleBillDto } from '../dto/settle-bill.dto';
import { BillEventEntity } from '../entities/bill-event.entity';
import { BillOfExchangeEntity } from '../entities/bill-of-exchange.entity';
import { BillEventsRepository } from '../repositories/bill-events.repository';
import { BillsOfExchangeRepository } from '../repositories/bills-of-exchange.repository';
import {
  BILL_ACCOUNTS,
  type BillKind,
  type BillStatus,
} from '../types/bill.types';

/**
 * Filtres acceptes par `listByOrg`.
 */
export interface ListBillsOptions {
  readonly kind?: BillKind;
  readonly status?: BillStatus;
  /** Borne haute d'echeance (effets dont `dueDate <= dueBefore`). */
  readonly dueBefore?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Vue agregee retournee par `findById` : l'effet + son journal
 * d'evenements (ordre antechronologique).
 */
export interface BillWithEvents {
  readonly bill: BillOfExchangeEntity;
  readonly events: ReadonlyArray<BillEventEntity>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Journal par defaut pour les operations bancaires (encaissement, escompte). */
const DEFAULT_BANK_JOURNAL_CODE = 'BQ' as const;
/** Journal par defaut pour les operations diverses (emission, impaye). */
const DEFAULT_OD_JOURNAL_CODE = 'OD' as const;

interface JournalLineSpec {
  readonly accountCode: string;
  readonly debit: number;
  readonly credit: number;
}

/**
 * W4.6 — Service applicatif des effets de commerce SYSCOHADA.
 *
 * Responsabilites :
 *   - emettre / escompter / encaisser / declarer impaye un effet
 *   - generer l'ecriture comptable double partie associee a chaque
 *     evenement (sauf cas explicite ou aucune ecriture n'est requise)
 *   - garantir la coherence des transitions de statut et la
 *     correspondance status ↔ currentLocationAccount
 *
 * Transitions de statut :
 *   Receivable :
 *     - issue          → status='issued',     loc='412'
 *     - discount       → status='discounted', loc='415'  (depuis 'issued')
 *     - settle issued  → status='paid'        (loc='412' inchange, l'ecriture
 *                        debite 5121 et credite 412 — l'effet quitte le poste)
 *     - settle discounted → status='paid'     (D 415 / C 412 : on solde le
 *                        suspens 415 et la creance 412)
 *     - markUnpaid     → status='unpaid'      (D 4131 / C 412 ou 415)
 *
 *   Payable :
 *     - issue          → status='issued',     loc='402'
 *     - settle issued  → status='paid'        (D 402 / C 5121)
 *
 * Conventions :
 *   - montants `string` decimal (NUMERIC 15,2 cote DB)
 *   - aucune mutation in-place : on lit, on calcule, on persiste un
 *     patch via le repository
 */
@Injectable()
export class BillsOfExchangeService {
  private readonly logger = new Logger(BillsOfExchangeService.name);

  constructor(
    private readonly billsRepo: BillsOfExchangeRepository,
    private readonly eventsRepo: BillEventsRepository,
    private readonly entriesService: EntriesService,
  ) {}

  // ─── Queries ────────────────────────────────────────────────────────

  async findById(
    organizationId: TenantId,
    id: string,
  ): Promise<BillWithEvents> {
    assertTenantId(organizationId);
    const bill = await this.requireBill(organizationId, id);
    const events = await this.eventsRepo.listByBill(id, organizationId);
    return { bill, events };
  }

  async listByOrg(
    organizationId: TenantId,
    options: ListBillsOptions = {},
  ): Promise<ReadonlyArray<BillOfExchangeEntity>> {
    assertTenantId(organizationId);
    const all = await this.billsRepo.listByOrganization(organizationId, {
      kind: options.kind,
      status: options.status,
      dueBefore: options.dueBefore,
    });
    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.min(MAX_LIMIT, Math.max(1, options.limit ?? DEFAULT_LIMIT));
    return all.slice(offset, offset + limit);
  }

  // ─── Issue ──────────────────────────────────────────────────────────

  /**
   * Emission/acceptation d'un effet. Pose l'ecriture suivante :
   *   - receivable : D 412 / C `partnerAccountCode` (411x client)
   *   - payable    : D `partnerAccountCode` (401x fournisseur) / C 402
   */
  async issue(
    organizationId: TenantId,
    dto: CreateBillDto,
    actorId: string,
    ctx: AuditContext,
  ): Promise<BillOfExchangeEntity> {
    assertTenantId(organizationId);
    this.assertPositiveAmount(dto.nominalAmount, ERROR_CODES.BILL_INVALID_AMOUNT);

    const amount = Number(dto.nominalAmount);
    const isReceivable = dto.kind === 'receivable';
    const location = isReceivable
      ? BILL_ACCOUNTS.RECEIVABLE_HOLDING
      : BILL_ACCOUNTS.PAYABLE_HOLDING;

    const debitAccount = isReceivable
      ? BILL_ACCOUNTS.RECEIVABLE_HOLDING
      : dto.partnerAccountCode;
    const creditAccount = isReceivable
      ? dto.partnerAccountCode
      : BILL_ACCOUNTS.PAYABLE_HOLDING;

    const journalCode = dto.journalCode ?? DEFAULT_OD_JOURNAL_CODE;

    const entry = await this.entriesService.createDraft(
      organizationId,
      {
        journalCode,
        entryDate: dto.issueDate,
        description: `Emission effet ${dto.billNumber} — ${dto.partnerName}`,
        lines: this.toLines(
          [
            { accountCode: debitAccount, debit: amount, credit: 0 },
            { accountCode: creditAccount, debit: 0, credit: amount },
          ],
          dto.note ?? null,
        ),
      },
      actorId,
      ctx,
    );

    const bill = await this.billsRepo.create({
      organizationId,
      kind: dto.kind,
      partnerAccountCode: dto.partnerAccountCode,
      partnerName: dto.partnerName,
      billNumber: dto.billNumber,
      issueDate: dto.issueDate,
      dueDate: dto.dueDate,
      nominalAmount: this.normalize(dto.nominalAmount),
      status: 'issued',
      currentLocationAccount: location,
      originalJournalEntryId: entry.id,
      note: dto.note ?? null,
      createdById: actorId,
    });

    await this.eventsRepo.create({
      billId: bill.id,
      organizationId,
      eventType: 'issuance',
      eventDate: dto.issueDate,
      amount: bill.nominalAmount,
      journalEntryId: entry.id,
      note: dto.note ?? null,
      createdById: actorId,
    });

    this.logger.log(
      `Bill ${bill.id} issued — kind=${dto.kind} amount=${bill.nominalAmount}`,
    );
    return bill;
  }

  // ─── Discount ───────────────────────────────────────────────────────

  /**
   * Escompte bancaire d'un effet a recevoir status='issued'. Pose
   * l'ecriture D 5121 net + D 6745 escompte + D 6312 frais / C 415
   * nominal et bascule l'effet en `discounted` sur le compte 415.
   */
  async discount(
    organizationId: TenantId,
    billId: string,
    dto: DiscountBillDto,
    actorId: string,
    ctx: AuditContext,
  ): Promise<BillOfExchangeEntity> {
    assertTenantId(organizationId);

    const bill = await this.requireBill(organizationId, billId);
    if (bill.kind !== 'receivable') {
      throw new AppException(ERROR_CODES.BILL_INVALID_STATE_FOR_ACTION, {
        message: `Only receivable bills can be discounted (bill ${billId} is ${bill.kind}).`,
      });
    }
    if (bill.status !== 'issued') {
      throw new AppException(ERROR_CODES.BILL_INVALID_STATE_FOR_ACTION, {
        message: `Bill ${billId} must be 'issued' to be discounted (current=${bill.status}).`,
      });
    }
    this.assertNonNegativeAmount(dto.discountFee, ERROR_CODES.BILL_INVALID_AMOUNT);
    this.assertNonNegativeAmount(dto.bankFee, ERROR_CODES.BILL_INVALID_AMOUNT);

    const nominal = Number(bill.nominalAmount);
    const discountFee = Number(dto.discountFee);
    const bankFee = Number(dto.bankFee);
    const net = nominal - discountFee - bankFee;

    if (net <= 0) {
      throw new AppException(ERROR_CODES.BILL_NEGATIVE_NET, {
        message: `Net amount must be > 0 (nominal=${nominal}, discount=${discountFee}, bank=${bankFee}).`,
      });
    }

    const lines: JournalLineSpec[] = [
      { accountCode: BILL_ACCOUNTS.BANK, debit: net, credit: 0 },
    ];
    if (discountFee > 0) {
      lines.push({
        accountCode: BILL_ACCOUNTS.DISCOUNT_FEE,
        debit: discountFee,
        credit: 0,
      });
    }
    if (bankFee > 0) {
      lines.push({
        accountCode: BILL_ACCOUNTS.BANK_FEE,
        debit: bankFee,
        credit: 0,
      });
    }
    lines.push({
      accountCode: BILL_ACCOUNTS.RECEIVABLE_DISCOUNTED,
      debit: 0,
      credit: nominal,
    });

    const journalCode = dto.journalCode ?? DEFAULT_BANK_JOURNAL_CODE;
    const entry = await this.entriesService.createDraft(
      organizationId,
      {
        journalCode,
        entryDate: dto.eventDate,
        description: `Escompte effet ${bill.billNumber} — ${bill.partnerName}`,
        lines: this.toLines(lines, dto.note ?? null),
      },
      actorId,
      ctx,
    );

    const updated = await this.billsRepo.update(billId, organizationId, {
      status: 'discounted',
      currentLocationAccount: BILL_ACCOUNTS.RECEIVABLE_DISCOUNTED,
    });

    await this.eventsRepo.create({
      billId,
      organizationId,
      eventType: 'discount',
      eventDate: dto.eventDate,
      amount: this.normalize(bill.nominalAmount),
      discountFee: this.normalize(dto.discountFee),
      bankFee: this.normalize(dto.bankFee),
      netAmount: net.toFixed(2),
      journalEntryId: entry.id,
      note: dto.note ?? null,
      createdById: actorId,
    });

    return updated;
  }

  // ─── Settle (payment) ───────────────────────────────────────────────

  /**
   * Paiement / encaissement a l'echeance. La contrepartie depend du
   * (kind, status courant) — voir matrice dans la docstring de classe.
   */
  async settle(
    organizationId: TenantId,
    billId: string,
    dto: SettleBillDto,
    actorId: string,
    ctx: AuditContext,
  ): Promise<BillOfExchangeEntity> {
    assertTenantId(organizationId);

    const bill = await this.requireBill(organizationId, billId);
    const amount = Number(bill.nominalAmount);

    let debitAccount: string;
    let creditAccount: string;
    let defaultJournal: string;

    if (bill.kind === 'receivable' && bill.status === 'issued') {
      // Effet encaisse directement par l'entreprise.
      debitAccount = BILL_ACCOUNTS.BANK;
      creditAccount = BILL_ACCOUNTS.RECEIVABLE_HOLDING;
      defaultJournal = DEFAULT_BANK_JOURNAL_CODE;
    } else if (bill.kind === 'receivable' && bill.status === 'discounted') {
      // Effet escompte effectivement paye par le client a la banque —
      // on solde le compte de creance 412 contre le suspens 415.
      debitAccount = BILL_ACCOUNTS.RECEIVABLE_DISCOUNTED;
      creditAccount = BILL_ACCOUNTS.RECEIVABLE_HOLDING;
      defaultJournal = DEFAULT_OD_JOURNAL_CODE;
    } else if (bill.kind === 'payable' && bill.status === 'issued') {
      // Paiement de l'effet a payer par decaissement.
      debitAccount = BILL_ACCOUNTS.PAYABLE_HOLDING;
      creditAccount = BILL_ACCOUNTS.BANK;
      defaultJournal = DEFAULT_BANK_JOURNAL_CODE;
    } else {
      throw new AppException(ERROR_CODES.BILL_INVALID_STATE_FOR_ACTION, {
        message: `Bill ${billId} cannot be settled in state (kind=${bill.kind}, status=${bill.status}).`,
      });
    }

    const journalCode = dto.journalCode ?? defaultJournal;
    const entry = await this.entriesService.createDraft(
      organizationId,
      {
        journalCode,
        entryDate: dto.eventDate,
        description: `Reglement effet ${bill.billNumber} — ${bill.partnerName}`,
        lines: this.toLines(
          [
            { accountCode: debitAccount, debit: amount, credit: 0 },
            { accountCode: creditAccount, debit: 0, credit: amount },
          ],
          dto.note ?? null,
        ),
      },
      actorId,
      ctx,
    );

    const updated = await this.billsRepo.update(billId, organizationId, {
      status: 'paid',
    });

    await this.eventsRepo.create({
      billId,
      organizationId,
      eventType: 'payment',
      eventDate: dto.eventDate,
      amount: this.normalize(bill.nominalAmount),
      journalEntryId: entry.id,
      note: dto.note ?? null,
      createdById: actorId,
    });

    return updated;
  }

  // ─── Mark unpaid ────────────────────────────────────────────────────

  /**
   * Retour impaye sur un effet a recevoir. Bascule en clients douteux
   * (4131) en contrepartie du compte ou reside l'effet (412 ou 415).
   * Pas de gestion d'impaye cote effets a payer (l'entreprise est le
   * tireur ici, l'impaye n'a pas la meme semantique comptable).
   */
  async markUnpaid(
    organizationId: TenantId,
    billId: string,
    dto: SettleBillDto,
    actorId: string,
    ctx: AuditContext,
  ): Promise<BillOfExchangeEntity> {
    assertTenantId(organizationId);

    const bill = await this.requireBill(organizationId, billId);
    if (bill.kind !== 'receivable') {
      throw new AppException(ERROR_CODES.BILL_INVALID_STATE_FOR_ACTION, {
        message: `Only receivable bills can be marked unpaid (bill ${billId} is ${bill.kind}).`,
      });
    }
    if (bill.status !== 'issued' && bill.status !== 'discounted') {
      throw new AppException(ERROR_CODES.BILL_INVALID_STATE_FOR_ACTION, {
        message: `Bill ${billId} cannot be marked unpaid in state ${bill.status}.`,
      });
    }

    const amount = Number(bill.nominalAmount);
    const creditAccount = bill.currentLocationAccount; // 412 ou 415
    const journalCode = dto.journalCode ?? DEFAULT_OD_JOURNAL_CODE;

    const entry = await this.entriesService.createDraft(
      organizationId,
      {
        journalCode,
        entryDate: dto.eventDate,
        description: `Impaye effet ${bill.billNumber} — ${bill.partnerName}`,
        lines: this.toLines(
          [
            {
              accountCode: BILL_ACCOUNTS.DOUBTFUL_CUSTOMER,
              debit: amount,
              credit: 0,
            },
            { accountCode: creditAccount, debit: 0, credit: amount },
          ],
          dto.note ?? null,
        ),
      },
      actorId,
      ctx,
    );

    const updated = await this.billsRepo.update(billId, organizationId, {
      status: 'unpaid',
    });

    await this.eventsRepo.create({
      billId,
      organizationId,
      eventType: 'unpaid_return',
      eventDate: dto.eventDate,
      amount: this.normalize(bill.nominalAmount),
      journalEntryId: entry.id,
      note: dto.note ?? null,
      createdById: actorId,
    });

    return updated;
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async requireBill(
    organizationId: TenantId,
    id: string,
  ): Promise<BillOfExchangeEntity> {
    const bill = await this.billsRepo.findById(id, organizationId);
    if (!bill) {
      throw new AppException(ERROR_CODES.BILL_NOT_FOUND, {
        message: `Bill of exchange '${id}' not found in this organization.`,
      });
    }
    return bill;
  }

  private assertPositiveAmount(
    amount: string,
    code: 'BILL_INVALID_AMOUNT',
  ): void {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      throw new AppException(ERROR_CODES[code], {
        message: `Amount must be a positive number, got '${amount}'.`,
      });
    }
  }

  private assertNonNegativeAmount(
    amount: string,
    code: 'BILL_INVALID_AMOUNT',
  ): void {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      throw new AppException(ERROR_CODES[code], {
        message: `Amount must be >= 0, got '${amount}'.`,
      });
    }
  }

  private normalize(amount: string): string {
    return Number(amount).toFixed(2);
  }

  private toLines(
    specs: ReadonlyArray<JournalLineSpec>,
    description: string | null,
  ): CreateLineInput[] {
    return specs.map((spec) => ({
      accountCode: spec.accountCode,
      debit: spec.debit,
      credit: spec.credit,
      description,
    }));
  }
}
