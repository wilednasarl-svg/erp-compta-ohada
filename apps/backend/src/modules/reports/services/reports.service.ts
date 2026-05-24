import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { OrganizationAccountRepository } from '../../accounting-plan/repositories/organization-account.repository';
import {
  ReportsRepository,
  type GeneralLedgerRow,
  type TrialBalanceRow,
} from '../repositories/reports.repository';

export interface TrialBalanceQuery {
  readonly fromDate: string;
  readonly toDate: string;
  readonly accountClass?: number;
  readonly accountCodeFrom?: string;
  readonly accountCodeTo?: string;
  readonly hideEmpty?: boolean;
}

export interface TrialBalanceReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly rows: readonly TrialBalanceRow[];
  readonly totals: {
    readonly openingDebit: string;
    readonly openingCredit: string;
    readonly periodDebit: string;
    readonly periodCredit: string;
    readonly endingDebit: string;
    readonly endingCredit: string;
  };
}

export interface GeneralLedgerQuery {
  readonly accountId: string;
  readonly fromDate: string;
  readonly toDate: string;
}

export interface GeneralLedgerEntry extends GeneralLedgerRow {
  /** Cumulative debit-credit balance up to and including this line. */
  readonly runningBalance: string;
}

export interface GeneralLedgerReport {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly accountClass: number;
  readonly fromDate: string;
  readonly toDate: string;
  readonly opening: { openingDebit: string; openingCredit: string };
  readonly lines: readonly GeneralLedgerEntry[];
  readonly totals: {
    readonly periodDebit: string;
    readonly periodCredit: string;
    readonly endingDebit: string;
    readonly endingCredit: string;
  };
}

/**
 * `ReportsService` — Module 9 wave 1 accounting reports.
 *
 *   - `getTrialBalance`  : balance générale (one row per account).
 *   - `getGeneralLedger` : grand livre d'un compte (chronologique + cumul).
 *
 * Both reports are *strictly read-only*: they project validated
 * `journal_entry_lines` and never touch the DB beyond the SELECT. No
 * audit event is emitted on report consumption — the audit trail
 * already covers the writes (entry_created / entry_validated).
 *
 * Money arithmetic uses JS numbers internally for the running balance
 * (the only place a sequential reduce is needed); inputs and outputs
 * stay as `string` for DECIMAL(15,2) fidelity. Tolerance of 0.005 on
 * the trial-balance totals would only matter if we did per-account
 * net rounding before summing — which we don't (we sum raw cents).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly repo: ReportsRepository,
    private readonly accounts: OrganizationAccountRepository,
  ) {}

  async getTrialBalance(
    organizationId: TenantId,
    query: TrialBalanceQuery,
  ): Promise<TrialBalanceReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);

    const rows = await this.repo.trialBalance(organizationId, query);
    const filtered =
      query.hideEmpty === true
        ? rows.filter(
            (r) =>
              Number(r.openingDebit) !== 0 ||
              Number(r.openingCredit) !== 0 ||
              Number(r.periodDebit) !== 0 ||
              Number(r.periodCredit) !== 0,
          )
        : rows;

    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      rows: filtered,
      totals: this.computeTrialBalanceTotals(filtered),
    };
  }

  async getGeneralLedger(
    organizationId: TenantId,
    query: GeneralLedgerQuery,
  ): Promise<GeneralLedgerReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);

    const account = await this.accounts.findById(query.accountId, organizationId);
    if (account === null) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_FOUND, {
        message: `Account ${query.accountId} not found in this organisation.`,
      });
    }

    const [rawLines, opening] = await Promise.all([
      this.repo.generalLedger(organizationId, query),
      this.repo.generalLedgerOpening(organizationId, query.accountId, query.fromDate),
    ]);

    // Compute running balance starting from opening (debit positive,
    // credit negative). One pass over the chronologically-ordered list.
    let running = Number(opening.openingDebit) - Number(opening.openingCredit);
    const lines: GeneralLedgerEntry[] = rawLines.map((row) => {
      running += Number(row.debit) - Number(row.credit);
      return { ...row, runningBalance: running.toFixed(2) };
    });

    const periodDebit = rawLines.reduce((s, r) => s + Number(r.debit), 0);
    const periodCredit = rawLines.reduce((s, r) => s + Number(r.credit), 0);
    const totalDebit = Number(opening.openingDebit) + periodDebit;
    const totalCredit = Number(opening.openingCredit) + periodCredit;
    const net = totalDebit - totalCredit;

    return {
      accountId: account.id,
      accountCode: account.code,
      accountLabel: account.label,
      accountClass: account.class,
      fromDate: query.fromDate,
      toDate: query.toDate,
      opening,
      lines,
      totals: {
        periodDebit: periodDebit.toFixed(2),
        periodCredit: periodCredit.toFixed(2),
        endingDebit: (net > 0 ? net : 0).toFixed(2),
        endingCredit: (net < 0 ? -net : 0).toFixed(2),
      },
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private assertDateRange(fromDate: string, toDate: string): void {
    if (!ReportsService.isYmd(fromDate) || !ReportsService.isYmd(toDate)) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: `Both fromDate and toDate must be YYYY-MM-DD (got ${fromDate}, ${toDate}).`,
      });
    }
    if (fromDate > toDate) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: `fromDate must be <= toDate (got ${fromDate} > ${toDate}).`,
      });
    }
  }

  static isYmd(s: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  private computeTrialBalanceTotals(rows: readonly TrialBalanceRow[]): {
    openingDebit: string;
    openingCredit: string;
    periodDebit: string;
    periodCredit: string;
    endingDebit: string;
    endingCredit: string;
  } {
    const sum = (key: keyof TrialBalanceRow): number =>
      rows.reduce((s, r) => s + Number(r[key] as string), 0);
    return {
      openingDebit: sum('openingDebit').toFixed(2),
      openingCredit: sum('openingCredit').toFixed(2),
      periodDebit: sum('periodDebit').toFixed(2),
      periodCredit: sum('periodCredit').toFixed(2),
      endingDebit: sum('endingDebit').toFixed(2),
      endingCredit: sum('endingCredit').toFixed(2),
    };
  }
}
