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
  ): Promise<AccountingPeriodEntity> {
    assertTenantId(organizationId);
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    const label = String(year);

    const annual = await this.periodsRepo.create({
      organizationId,
      parentId: null,
      kind: 'ANNUAL',
      label,
      startDate,
      endDate,
    });

    if (split === 'MONTHLY') {
      await this.createMonthlySubPeriods(organizationId, annual.id, year);
    } else if (split === 'QUARTERLY') {
      await this.createQuarterlySubPeriods(organizationId, annual.id, year);
    }

    await this.emitAudit('journals.period_created', annual.id, { year, split }, ctx).catch(
      (e) => this.logger.warn(`Audit failed: ${String(e)}`),
    );

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

    await this.emitAudit('journals.period_closed', periodId, { kind: period.kind, label: period.label }, ctx).catch(
      (e) => this.logger.warn(`Audit failed: ${String(e)}`),
    );
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

    await this.emitAudit('journals.period_reopened', periodId, { reason, label: period.label }, ctx).catch(
      (e) => this.logger.warn(`Audit failed: ${String(e)}`),
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async createMonthlySubPeriods(
    organizationId: TenantId,
    parentId: string,
    year: number,
  ): Promise<void> {
    const months = [
      { m: 1, label: `Jan ${year}`, start: `${year}-01-01`, end: `${year}-01-31` },
      { m: 2, label: `Fév ${year}`, start: `${year}-02-01`, end: this.lastDayOfMonth(year, 2) },
      { m: 3, label: `Mar ${year}`, start: `${year}-03-01`, end: `${year}-03-31` },
      { m: 4, label: `Avr ${year}`, start: `${year}-04-01`, end: `${year}-04-30` },
      { m: 5, label: `Mai ${year}`, start: `${year}-05-01`, end: `${year}-05-31` },
      { m: 6, label: `Jun ${year}`, start: `${year}-06-01`, end: `${year}-06-30` },
      { m: 7, label: `Jul ${year}`, start: `${year}-07-01`, end: `${year}-07-31` },
      { m: 8, label: `Aoû ${year}`, start: `${year}-08-01`, end: `${year}-08-31` },
      { m: 9, label: `Sep ${year}`, start: `${year}-09-01`, end: `${year}-09-30` },
      { m: 10, label: `Oct ${year}`, start: `${year}-10-01`, end: `${year}-10-31` },
      { m: 11, label: `Nov ${year}`, start: `${year}-11-01`, end: `${year}-11-30` },
      { m: 12, label: `Déc ${year}`, start: `${year}-12-01`, end: `${year}-12-31` },
    ];
    for (const { label, start, end } of months) {
      await this.periodsRepo.create({ organizationId, parentId, kind: 'MONTHLY', label, startDate: start, endDate: end });
    }
  }

  private async createQuarterlySubPeriods(
    organizationId: TenantId,
    parentId: string,
    year: number,
  ): Promise<void> {
    const quarters = [
      { label: `T1 ${year}`, start: `${year}-01-01`, end: `${year}-03-31` },
      { label: `T2 ${year}`, start: `${year}-04-01`, end: `${year}-06-30` },
      { label: `T3 ${year}`, start: `${year}-07-01`, end: `${year}-09-30` },
      { label: `T4 ${year}`, start: `${year}-10-01`, end: `${year}-12-31` },
    ];
    for (const { label, start, end } of quarters) {
      await this.periodsRepo.create({ organizationId, parentId, kind: 'QUARTERLY', label, startDate: start, endDate: end });
    }
  }

  private lastDayOfMonth(year: number, month: number): string {
    const d = new Date(year, month, 0);
    return `${year}-${String(month).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
