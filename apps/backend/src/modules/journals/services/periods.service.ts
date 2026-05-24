import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { AccountingPeriodRepository } from '../repositories/accounting-period.repository';
import { JournalEntryRepository } from '../repositories/journal-entry.repository';
import type { AccountingPeriodEntity } from '../entities/accounting-period.entity';
import type { FiscalYearSplit } from '../types/journal.types';

@Injectable()
export class PeriodsService {
  private static readonly MODULE = 'journals' as const;
  private readonly logger = new Logger(PeriodsService.name);

  constructor(
    private readonly periodsRepo: AccountingPeriodRepository,
    private readonly entriesRepo: JournalEntryRepository,
    private readonly audit: AuditTrailService,
  ) {}

  async listForOrg(organizationId: TenantId): Promise<AccountingPeriodEntity[]> {
    assertTenantId(organizationId);
    return this.periodsRepo.listByOrganization(organizationId);
  }

  async getById(organizationId: TenantId, id: string): Promise<AccountingPeriodEntity> {
    assertTenantId(organizationId);
    const period = await this.periodsRepo.findById(id, organizationId);
    if (!period) {
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_NOT_FOUND, {
        message: `Accounting period '${id}' not found.`,
      });
    }
    return period;
  }

  async createFiscalYear(
    organizationId: TenantId,
    year: number,
    split: FiscalYearSplit,
    actorId: string,
    ctx: AuditContext,
    options: { startDate?: string } = {},
  ): Promise<AccountingPeriodEntity> {
    assertTenantId(organizationId);

    // Resolve the [start, end] interval. Default (no startDate) =
    // calendar year (Jan 1 → Dec 31). With startDate = an arbitrary
    // first day (offset fiscal year, e.g. agricultural Apr 1 → Mar 31).
    const start = options.startDate ?? `${year}-01-01`;
    if (!PeriodsService.isValidYmd(start)) {
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_OVERLAPS, {
        message: `startDate must be YYYY-MM-DD (received: ${start}).`,
      });
    }
    const startDate = start;
    const endDate = PeriodsService.lastDayOfFiscalYear(startDate);
    const isCalendar = PeriodsService.isCalendarStart(startDate);
    const label = isCalendar ? String(year) : `${startDate} → ${endDate}`;

    // Refuse overlap with an existing ANNUAL period for this org.
    const overlap = await this.periodsRepo.findOverlappingAnnual(
      organizationId,
      startDate,
      endDate,
    );
    if (overlap !== null) {
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_OVERLAPS, {
        message: `Fiscal year ${startDate}..${endDate} overlaps existing period '${overlap.label}' (${overlap.startDate}..${overlap.endDate}).`,
        details: {
          requested: { startDate, endDate },
          existing: { id: overlap.id, label: overlap.label },
        },
      });
    }

    const annual = await this.periodsRepo.create({
      organizationId,
      parentId: null,
      kind: 'ANNUAL',
      label,
      startDate,
      endDate,
    });

    if (split === 'MONTHLY') {
      await this.createMonthlySubPeriods(organizationId, annual.id, year, startDate);
    } else if (split === 'QUARTERLY') {
      await this.createQuarterlySubPeriods(organizationId, annual.id, year, startDate);
    }

    await this.emitAudit(
      'journals.period_created',
      annual.id,
      {
        year,
        split,
        startDate,
        endDate,
        type: isCalendar ? 'CALENDAR' : 'OFFSET',
      },
      { ...ctx, userId: actorId },
    ).catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));

    return annual;
  }

  async closePeriod(
    organizationId: TenantId,
    periodId: string,
    actorId: string,
    ctx: AuditContext,
  ): Promise<void> {
    assertTenantId(organizationId);
    const period = await this.getById(organizationId, periodId);

    if (period.status === 'closed') {
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_CLOSED, {
        message: `Period '${periodId}' is already closed.`,
      });
    }

    const draftCount = await this.entriesRepo.countDraftsByPeriod(organizationId, periodId);
    if (draftCount > 0) {
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_HAS_DRAFTS, {
        message: `Period has ${draftCount} draft entries — validate or delete them first.`,
      });
    }

    await this.periodsRepo.closePeriod(periodId, actorId);

    // Cascade: close children too
    if (period.kind === 'ANNUAL') {
      const children = await this.periodsRepo.listChildren(periodId);
      for (const child of children) {
        if (child.status === 'open') {
          await this.periodsRepo.closePeriod(child.id, actorId);
        }
      }
    }

    await this.emitAudit(
      'journals.period_closed',
      periodId,
      { kind: period.kind, label: period.label },
      ctx,
    ).catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));
  }

  async reopenPeriod(
    organizationId: TenantId,
    periodId: string,
    reason: string,
    actorId: string,
    ctx: AuditContext,
  ): Promise<void> {
    assertTenantId(organizationId);
    if (!reason || reason.trim().length === 0) {
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_REOPEN_REASON_REQUIRED, {
        message: 'A reason is required to reopen a closed period.',
      });
    }
    const period = await this.getById(organizationId, periodId);
    if (period.status === 'open') {
      return; // Already open — idempotent
    }

    await this.periodsRepo.reopenPeriod(periodId, reason.trim());

    await this.emitAudit(
      'journals.period_reopened',
      periodId,
      { reason, label: period.label },
      { ...ctx, userId: actorId },
    ).catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * 12 monthly sub-periods rolling forward from the fiscal year start.
   * For an offset year (e.g. start = 2026-04-01), this produces
   * Avr 2026, Mai 2026, …, Mar 2027 — each ending on the correct
   * last day of its month (28/29 Feb on leap years included).
   */
  private async createMonthlySubPeriods(
    organizationId: TenantId,
    parentId: string,
    year: number,
    startDate: string,
  ): Promise<void> {
    const [sy, sm] = PeriodsService.parseYmd(startDate);
    const months: Array<{ label: string; start: string; end: string }> = [];
    for (let i = 0; i < 12; i++) {
      const m = ((sm - 1 + i) % 12) + 1;
      const y = sy + Math.floor((sm - 1 + i) / 12);
      months.push({
        label: `${PeriodsService.MONTH_LABELS[m - 1]} ${y}`,
        start: PeriodsService.ymd(y, m, 1),
        end: PeriodsService.lastDayOfMonthYmd(y, m),
      });
    }
    for (const { label, start, end } of months) {
      await this.periodsRepo.create({
        organizationId,
        parentId,
        kind: 'MONTHLY',
        label,
        startDate: start,
        endDate: end,
      });
    }
    void year;
  }

  /**
   * 4 quarterly sub-periods rolling forward from the fiscal year start.
   */
  private async createQuarterlySubPeriods(
    organizationId: TenantId,
    parentId: string,
    year: number,
    startDate: string,
  ): Promise<void> {
    const [sy, sm] = PeriodsService.parseYmd(startDate);
    const quarters: Array<{ label: string; start: string; end: string }> = [];
    for (let q = 0; q < 4; q++) {
      const firstMonthIdx = q * 3;
      const lastMonthIdx = firstMonthIdx + 2;
      const startM = ((sm - 1 + firstMonthIdx) % 12) + 1;
      const startY = sy + Math.floor((sm - 1 + firstMonthIdx) / 12);
      const endM = ((sm - 1 + lastMonthIdx) % 12) + 1;
      const endY = sy + Math.floor((sm - 1 + lastMonthIdx) / 12);
      quarters.push({
        label: `T${q + 1} ${startY === endY ? startY : `${startY}/${endY}`}`,
        start: PeriodsService.ymd(startY, startM, 1),
        end: PeriodsService.lastDayOfMonthYmd(endY, endM),
      });
    }
    for (const { label, start, end } of quarters) {
      await this.periodsRepo.create({
        organizationId,
        parentId,
        kind: 'QUARTERLY',
        label,
        startDate: start,
        endDate: end,
      });
    }
    void year;
  }

  // ─── Static date helpers (pure, easy to unit-test) ────────────────

  private static readonly MONTH_LABELS = [
    'Jan',
    'Fév',
    'Mar',
    'Avr',
    'Mai',
    'Jun',
    'Jul',
    'Aoû',
    'Sep',
    'Oct',
    'Nov',
    'Déc',
  ] as const;

  static isValidYmd(s: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = PeriodsService.parseYmd(s);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const last = PeriodsService.lastDayOfMonth(y, m);
    return d <= last;
  }

  static parseYmd(s: string): [number, number, number] {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return [y, m, d];
  }

  static ymd(y: number, m: number, d: number): string {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /** Returns the last *calendar* day of the given month (handles leap years). */
  static lastDayOfMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
  }

  static lastDayOfMonthYmd(year: number, month: number): string {
    return PeriodsService.ymd(year, month, PeriodsService.lastDayOfMonth(year, month));
  }

  /**
   * End of a 12-month fiscal year that starts at `startDate`. Computed as
   * (startDate + 12 months − 1 day), correctly handling the Feb 29 case
   * (e.g. start = 2024-02-29 → end = 2025-02-28).
   */
  static lastDayOfFiscalYear(startDate: string): string {
    const [y, m, d] = PeriodsService.parseYmd(startDate);
    let endY = y + 1;
    let endM = m;
    let endD = d - 1;
    if (endD < 1) {
      endM -= 1;
      if (endM < 1) {
        endM = 12;
        endY -= 1;
      }
      endD = PeriodsService.lastDayOfMonth(endY, endM);
    } else {
      // Clamp to the last day of endM (e.g. 2024-02-29 + 12m − 1d → 2025-02-28).
      const max = PeriodsService.lastDayOfMonth(endY, endM);
      if (endD > max) endD = max;
    }
    return PeriodsService.ymd(endY, endM, endD);
  }

  /** Calendar year = starts on Jan 1. */
  static isCalendarStart(startDate: string): boolean {
    return /-01-01$/.test(startDate);
  }

  private async emitAudit(
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
    ctx: AuditContext,
  ): Promise<void> {
    await this.audit.record({
      module: PeriodsService.MODULE,
      action,
      entityType: 'accounting_period',
      entityId,
      metadata,
      ctx,
    });
  }
}
