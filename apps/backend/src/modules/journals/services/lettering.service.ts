import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import type { LetteringStatus, PartnerLetteringEntity } from '../entities/partner-lettering.entity';
import { JournalEntryLineRepository } from '../repositories/journal-entry-line.repository';
import { PartnerLetteringRepository } from '../repositories/partner-lettering.repository';

export interface CreateLetteringInput {
  readonly journalEntryLineIds: readonly string[];
}

export interface LetteringView {
  readonly id: string;
  readonly organizationId: string;
  readonly letteringCode: string;
  readonly partnerAccountId: string;
  readonly partnerAccountCode: string;
  readonly partnerLabel: string;
  readonly totalAmount: string;
  readonly status: LetteringStatus;
  readonly lineIds: readonly string[];
  readonly createdById: string;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
  readonly brokenAt: Date | null;
  readonly brokenReason: string | null;
}

export interface ListLetteringFilters {
  readonly partnerAccountId?: string;
  readonly status?: LetteringStatus;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * `LetteringService` — Module 8 wave 2 partner-account reconciliation.
 *
 * Lettrage groups N journal-entry lines on the same partner account
 * (4xx) so that `sum(debit) == sum(credit)` on the group. The classic
 * use case is "this invoice (debit on 411 client) was paid by this
 * receipt (credit on 411 client) — they are now reconciled."
 *
 * Invariants enforced at the service boundary (defence-in-depth on
 * top of the DB FK / CHECK constraints):
 *
 *   - at least 2 lines (a 1-line lettering would mean a 0-amount
 *     reconciliation — meaningless);
 *   - all lines belong to THIS tenant and SAME partner account;
 *   - parent journal entries are status `validated` (a draft line
 *     would mutate, breaking the lettrage invariant);
 *   - the partner account class is 40 (fournisseurs), 41 (clients),
 *     43 (organismes sociaux) or 44 (État, impôts et taxes). Classes
 *     43 and 44 are required to lettrer les soldes résiduels après
 *     contre-passation des charges à payer / produits à recevoir en
 *     N+1 (4281, 4287, 4381-4387, 4486, 4493-4496, 4498…);
 *   - sum(debit) == sum(credit) over the group;
 *   - no line already attached to an active lettering — `attachLettering`
 *     uses `WHERE lettering_id IS NULL` so a concurrent attach loses
 *     the race cleanly (the second caller sees 0 rows updated and
 *     surfaces `LETTERING_LINE_ALREADY_USED`).
 *
 * All mutations are audited via `AuditTrailService` (module 'journals',
 * actions `lettering_created` / `lettering_broken`). Audit failures are
 * swallow-and-warn — they never block the reconciliation itself.
 */
@Injectable()
export class LetteringService {
  private static readonly MODULE = 'journals' as const;
  private static readonly PARTNER_ACCOUNT_CLASSES: ReadonlySet<number> = new Set([40, 41, 43, 44]);
  private static readonly BALANCE_TOLERANCE = 0.005;

  private readonly logger = new Logger(LetteringService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly letteringRepo: PartnerLetteringRepository,
    private readonly lineRepo: JournalEntryLineRepository,
    private readonly audit: AuditTrailService,
  ) {}

  async create(
    organizationId: TenantId,
    input: CreateLetteringInput,
    actorId: string,
    ctx: AuditContext,
  ): Promise<LetteringView> {
    assertTenantId(organizationId);

    if (input.journalEntryLineIds.length < 2) {
      throw new AppException(ERROR_CODES.LETTERING_LINES_REQUIRED, {
        message: 'A lettering must group at least 2 lines.',
      });
    }

    const fetched = await this.lineRepo.listForLetteringCheck(
      organizationId,
      input.journalEntryLineIds,
    );
    if (fetched.length !== input.journalEntryLineIds.length) {
      throw new AppException(ERROR_CODES.LETTERING_LINES_REQUIRED, {
        message: `Only ${fetched.length}/${input.journalEntryLineIds.length} lines found in this tenant.`,
      });
    }

    // All lines must belong to ONE partner account.
    const accountIds = new Set(fetched.map((r) => r.line.accountId));
    if (accountIds.size !== 1) {
      throw new AppException(ERROR_CODES.LETTERING_MIXED_ACCOUNTS, {
        message: 'All lines must belong to the same partner account.',
        details: { accountIds: [...accountIds] },
      });
    }
    const partnerAccountId = fetched[0].line.accountId;

    // The shared account must be a partner account (class 40, 41, 43 or 44).
    const partnerAccount = fetched[0].line.account;
    const accountClass = this.classFromAccount(partnerAccount?.code, partnerAccount?.class);
    if (!LetteringService.PARTNER_ACCOUNT_CLASSES.has(accountClass)) {
      throw new AppException(ERROR_CODES.LETTERING_NOT_PARTNER_ACCOUNT, {
        message: `Account class ${accountClass} is not a partner account (40, 41, 43 or 44 required).`,
        details: { partnerAccountId, accountClass },
      });
    }

    // Every parent entry must be validated.
    const drafted = fetched.filter((r) => r.entryStatus !== 'validated');
    if (drafted.length > 0) {
      throw new AppException(ERROR_CODES.LETTERING_LINE_NOT_VALIDATED, {
        message: `${drafted.length} line(s) belong to a non-validated entry.`,
        details: { lineIds: drafted.map((r) => r.line.id) },
      });
    }

    // No line already lettered.
    const alreadyLettered = fetched.filter((r) => r.line.letteringId !== null);
    if (alreadyLettered.length > 0) {
      throw new AppException(ERROR_CODES.LETTERING_LINE_ALREADY_USED, {
        message: `${alreadyLettered.length} line(s) are already attached to a lettering.`,
        details: { lineIds: alreadyLettered.map((r) => r.line.id) },
      });
    }

    // Balance check.
    const totalDebit = fetched.reduce((s, r) => s + Number(r.line.debit), 0);
    const totalCredit = fetched.reduce((s, r) => s + Number(r.line.credit), 0);
    if (Math.abs(totalDebit - totalCredit) > LetteringService.BALANCE_TOLERANCE) {
      throw new AppException(ERROR_CODES.LETTERING_UNBALANCED, {
        message: `Group unbalanced: sum(debit)=${totalDebit}, sum(credit)=${totalCredit}.`,
        details: {
          totalDebit: Math.round(totalDebit * 100) / 100,
          totalCredit: Math.round(totalCredit * 100) / 100,
        },
      });
    }

    const partnerLabel = `${partnerAccount?.code ?? '???'} ${partnerAccount?.label ?? ''}`.trim();

    const result = await this.dataSource.transaction(async (manager) => {
      const code = await this.letteringRepo.nextLetteringCode(organizationId, manager);
      const totalAmount = totalDebit.toFixed(2);
      const lettering = await this.letteringRepo.create(
        {
          organizationId,
          letteringCode: code,
          partnerAccountId,
          partnerLabel,
          totalAmount,
          createdById: actorId,
          status: 'complete',
          completedAt: new Date(),
        },
        manager,
      );

      // Attach lines. The `WHERE lettering_id IS NULL` filter at the SQL
      // level catches a concurrent race: if another caller attached
      // these IDs between our pre-check and here, we get an affected
      // count < ids.length and undo by throwing — the transaction
      // rolls back the insert too.
      await this.lineRepo.attachLettering(
        input.journalEntryLineIds,
        lettering.id,
        organizationId,
        manager,
      );

      return lettering;
    });

    await this.audit
      .record({
        module: LetteringService.MODULE,
        action: 'lettering_created',
        entityType: 'partner_lettering',
        entityId: result.id,
        after: {
          letteringCode: result.letteringCode,
          partnerAccountId: result.partnerAccountId,
          totalAmount: result.totalAmount,
          lineIds: [...input.journalEntryLineIds],
        },
        ctx: { ...ctx, userId: actorId, organizationId },
        legacyEventType: 'journals.lettering.created',
      })
      .catch((e: unknown) => this.logger.warn(`Audit failed for lettering_created: ${String(e)}`));

    return this.toView(result, [...input.journalEntryLineIds]);
  }

  async breakLettering(
    organizationId: TenantId,
    letteringId: string,
    reason: string,
    actorId: string,
    ctx: AuditContext,
  ): Promise<void> {
    assertTenantId(organizationId);

    const lettering = await this.letteringRepo.findById(letteringId, organizationId);
    if (lettering === null) {
      throw new AppException(ERROR_CODES.LETTERING_NOT_FOUND);
    }
    if (lettering.status === 'broken') {
      throw new AppException(ERROR_CODES.LETTERING_ALREADY_BROKEN, {
        message: 'This lettering was already broken.',
      });
    }

    await this.dataSource.transaction(async (manager) => {
      await this.lineRepo.detachLettering(letteringId, organizationId, manager);
      await this.letteringRepo.markBroken(letteringId, organizationId, actorId, reason, manager);
    });

    await this.audit
      .record({
        module: LetteringService.MODULE,
        action: 'lettering_broken',
        entityType: 'partner_lettering',
        entityId: letteringId,
        before: { status: lettering.status },
        after: { status: 'broken', reason },
        ctx: { ...ctx, userId: actorId, organizationId },
        legacyEventType: 'journals.lettering.broken',
      })
      .catch((e: unknown) => this.logger.warn(`Audit failed for lettering_broken: ${String(e)}`));
  }

  async getById(organizationId: TenantId, letteringId: string): Promise<LetteringView> {
    assertTenantId(organizationId);
    const lettering = await this.letteringRepo.findById(letteringId, organizationId);
    if (lettering === null) {
      throw new AppException(ERROR_CODES.LETTERING_NOT_FOUND);
    }
    const lines = await this.lineRepo.listByAccountAndOrg(
      organizationId,
      lettering.partnerAccountId,
    );
    const lineIds = lines.filter((l) => l.letteringId === letteringId).map((l) => l.id);
    return this.toView(lettering, lineIds);
  }

  async listForOrg(
    organizationId: TenantId,
    filters: ListLetteringFilters = {},
  ): Promise<LetteringView[]> {
    assertTenantId(organizationId);
    const letterings = await this.letteringRepo.listForOrg(organizationId, filters);
    // For the list view we don't expand lineIds (heavy join); the
    // detail endpoint does. The view returns an empty `lineIds` here.
    return letterings.map((l) => this.toView(l, []));
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private classFromAccount(code: string | undefined, klass: number | undefined): number {
    // Prefer the explicit `class` column when present; fall back to
    // the first 2 digits of the code which is the SYSCOHADA classifier.
    if (typeof klass === 'number' && Number.isFinite(klass)) {
      // `class` is the OHADA top-level class (1-9). Partner accounts
      // live in class 4; the sub-class (40 fournisseurs, 41 clients,
      // 43 organismes sociaux, 44 État) requires the first 2 digits of
      // the code.
      if (klass === 4 && typeof code === 'string' && code.length >= 2) {
        return Number.parseInt(code.slice(0, 2), 10);
      }
      return klass;
    }
    if (typeof code === 'string' && code.length >= 2) {
      return Number.parseInt(code.slice(0, 2), 10);
    }
    return 0;
  }

  private toView(entity: PartnerLetteringEntity, lineIds: readonly string[]): LetteringView {
    return {
      id: entity.id,
      organizationId: entity.organizationId,
      letteringCode: entity.letteringCode,
      partnerAccountId: entity.partnerAccountId,
      partnerAccountCode: entity.partnerAccount?.code ?? '',
      partnerLabel: entity.partnerLabel,
      totalAmount: entity.totalAmount,
      status: entity.status,
      lineIds,
      createdById: entity.createdById,
      createdAt: entity.createdAt,
      completedAt: entity.completedAt,
      brokenAt: entity.brokenAt,
      brokenReason: entity.brokenReason,
    };
  }
}
