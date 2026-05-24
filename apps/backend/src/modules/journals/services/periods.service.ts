import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import { AuditTrailService } from '../../audit/services/audit-trail.service';
import { AccountingPeriodEntity } from '../entities/accounting-period.entity';
import { AccountingPeriodRepository } from '../repositories/accounting-period.repository';
import { JournalEntryRepository } from '../repositories/journal-entry.repository';
import type {
  AccountingPeriodKind,
  FiscalYearSplit,
} from '../types/journal.types';

export interface CreateFiscalYearInput {
  readonly organizationId: string;
  readonly year: number;
  readonly split: FiscalYearSplit;
  readonly ctx: AuditContext;
}

export interface AccountingPeriodView {
  readonly id: string;
  readonly organizationId: string;
  readonly parentId: string | null;
  readonly kind: AccountingPeriodKind;
  readonly label: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly status: 'open' | 'closed';
  readonly closedAt: Date | null;
  readonly closedBy: string | null;
}

/**
 * `PeriodsService` (BE-JE-10) — gestion des exercices comptables et de
 * leurs sous-périodes.
 *
 * Vague 1 : exercice calendaire (1ᵉʳ janvier → 31 décembre). Découpages
 * supportés : MONTHLY (12 sous-périodes), QUARTERLY (4 sous-périodes),
 * ANNUAL_ONLY (aucune sous-période).
 *
 * Exercices décalés (clôture juin/juin par exemple) → vague 2.
 */
@Injectable()
export class PeriodsService {
  constructor(
    private readonly periods: AccountingPeriodRepository,
    private readonly entries: JournalEntryRepository,
    private readonly audit: AuditTrailService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Crée un exercice annuel + ses sous-périodes selon `split`, le tout
   * dans une transaction unique.
   */
  async createFiscalYear(input: CreateFiscalYearInput): Promise<AccountingPeriodView[]> {
    const { organizationId, year, split, ctx } = input;
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year + 1}-01-01`;

    const all = await this.dataSource.transaction(async (manager) => {
      const annual = await this.periods.create(
        {
          organizationId,
          parentId: null,
          kind: 'ANNUAL',
          label: `Exercice ${year}`,
          startDate: yearStart,
          endDate: yearEnd,
        },
        manager,
      );

      const children: AccountingPeriodEntity[] = [];
      if (split === 'MONTHLY') {
        for (let m = 0; m < 12; m += 1) {
          const start = `${year}-${String(m + 1).padStart(2, '0')}-01`;
          const end = m === 11 ? `${year + 1}-01-01` : `${year}-${String(m + 2).padStart(2, '0')}-01`;
          children.push(
            await this.periods.create(
              {
                organizationId,
                parentId: annual.id,
                kind: 'MONTHLY',
                label: monthLabel(year, m + 1),
                startDate: start,
                endDate: end,
              },
              manager,
            ),
          );
        }
      } else if (split === 'QUARTERLY') {
        for (let q = 0; q < 4; q += 1) {
          const startMonth = q * 3 + 1;
          const endMonth = startMonth + 3;
          const start = `${year}-${String(startMonth).padStart(2, '0')}-01`;
          const end =
            endMonth > 12
              ? `${year + 1}-01-01`
              : `${year}-${String(endMonth).padStart(2, '0')}-01`;
          children.push(
            await this.periods.create(
              {
                organizationId,
                parentId: annual.id,
                kind: 'QUARTERLY',
                label: `T${q + 1} ${year}`,
                startDate: start,
                endDate: end,
              },
              manager,
            ),
          );
        }
      }

      return [annual, ...children];
    });

    await this.audit.record({
      module: 'workflows', // pas de module dédié journals dans AuditModule pour wave 1
      action: 'fiscal_year_created',
      entityType: 'accounting_period',
      entityId: all[0].id,
      after: { year, split, periodCount: all.length },
      ctx,
    });

    return all.map(toView);
  }

  async findContainingDate(
    organizationId: string,
    date: string,
    kind?: AccountingPeriodKind,
  ): Promise<AccountingPeriodEntity | null> {
    return this.periods.findContainingDate(organizationId, date, kind);
  }

  async assertOpenForDate(organizationId: string, date: string): Promise<AccountingPeriodEntity> {
    const period = await this.periods.findContainingDate(organizationId, date);
    if (!period) {
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_NOT_FOUND, {
        message: `No accounting period covers ${date} — create the fiscal year first`,
      });
    }
    if (period.status === 'closed') {
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_CLOSED, {
        message: `Accounting period ${period.label} is closed`,
        details: { periodId: period.id, periodLabel: period.label, date },
      });
    }
    return period;
  }

  async listForOrganization(organizationId: string): Promise<AccountingPeriodView[]> {
    const rows = await this.periods.listByOrganization(organizationId);
    return rows.map(toView);
  }

  /**
   * Clôture une période. Refuse s'il reste des drafts dans la période ou
   * une de ses sous-périodes (clôture en cascade).
   */
  async closePeriod(
    organizationId: string,
    periodId: string,
    ctx: AuditContext,
  ): Promise<AccountingPeriodView> {
    const period = await this.periods.findById(periodId, organizationId);
    if (!period) {
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_NOT_FOUND);
    }

    const toClose = await this.collectSelfAndOpenChildren(period, organizationId);

    for (const p of toClose) {
      const draftCount = await this.entries.countDraftsInPeriod(organizationId, p.id);
      if (draftCount > 0) {
        throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_HAS_DRAFTS, {
          message: `Period ${p.label} has ${draftCount} draft entries — validate or delete them first`,
          details: { periodId: p.id, draftCount },
        });
      }
    }

    await this.dataSource.transaction(async (manager: EntityManager) => {
      for (const p of toClose) {
        await manager
          .getRepository(AccountingPeriodEntity)
          .update(
            { id: p.id },
            { status: 'closed', closedAt: new Date(), closedBy: ctx.userId ?? null },
          );
      }
    });

    await this.audit.record({
      module: 'workflows',
      action: 'period_closed',
      entityType: 'accounting_period',
      entityId: period.id,
      before: { status: 'open' },
      after: { status: 'closed', cascadeCount: toClose.length },
      ctx,
    });

    const reloaded = await this.periods.findById(periodId, organizationId);
    return toView(reloaded!);
  }

  async reopenPeriod(
    organizationId: string,
    periodId: string,
    reason: string,
    ctx: AuditContext,
  ): Promise<AccountingPeriodView> {
    if (reason.trim().length === 0) {
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_REOPEN_REASON_REQUIRED, {
        message: 'Reopening an accounting period requires a non-empty reason',
      });
    }

    const period = await this.periods.findById(periodId, organizationId);
    if (!period) {
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_NOT_FOUND);
    }
    if (period.status === 'open') {
      return toView(period);
    }

    await this.periods.reopenPeriod(periodId, reason);

    await this.audit.record({
      module: 'workflows',
      action: 'period_reopened',
      entityType: 'accounting_period',
      entityId: period.id,
      before: { status: 'closed' },
      after: { status: 'open', reason },
      ctx,
    });

    const reloaded = await this.periods.findById(periodId, organizationId);
    return toView(reloaded!);
  }

  private async collectSelfAndOpenChildren(
    period: AccountingPeriodEntity,
    organizationId: string,
  ): Promise<AccountingPeriodEntity[]> {
    const result: AccountingPeriodEntity[] = [];
    const stack: AccountingPeriodEntity[] = [period];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current.status === 'open') result.push(current);
      const children = await this.periods.listChildren(current.id);
      for (const c of children) {
        if (c.organizationId === organizationId) stack.push(c);
      }
    }
    return result;
  }
}

function toView(entity: AccountingPeriodEntity): AccountingPeriodView {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    parentId: entity.parentId,
    kind: entity.kind,
    label: entity.label,
    startDate: entity.startDate,
    endDate: entity.endDate,
    status: entity.status,
    closedAt: entity.closedAt,
    closedBy: entity.closedBy,
  };
}

const FRENCH_MONTHS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];
function monthLabel(year: number, month: number): string {
  return `${FRENCH_MONTHS[month - 1]} ${year}`;
}
