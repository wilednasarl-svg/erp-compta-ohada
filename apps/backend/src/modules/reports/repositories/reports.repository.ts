import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { JournalEntryLineEntity } from '../../journals/entities/journal-entry-line.entity';

/**
 * Aggregated trial-balance row, one per organization-chart account.
 * Money columns are returned as `string` to preserve DECIMAL(15,2)
 * precision across the wire — clients should format display-side.
 */
export interface TrialBalanceRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly accountClass: number;
  readonly openingDebit: string;
  readonly openingCredit: string;
  readonly periodDebit: string;
  readonly periodCredit: string;
  readonly endingDebit: string;
  readonly endingCredit: string;
}

/**
 * A single line of the general-ledger drill-down, in chronological
 * order. `runningBalance` is computed in the service since SQL
 * window-functions are heavier than a sequential JS reduce here.
 */
export interface GeneralLedgerRow {
  readonly lineId: string;
  readonly entryId: string;
  readonly entryDate: string;
  readonly journalCode: string;
  readonly entryNumber: number;
  readonly description: string | null;
  readonly debit: string;
  readonly credit: string;
  readonly letteringCode: string | null;
}

export interface TrialBalanceFilters {
  readonly fromDate: string;
  readonly toDate: string;
  /** Only return accounts in this OHADA class (1-9). Optional. */
  readonly accountClass?: number;
  /** Inclusive lower bound on `code`. Optional. */
  readonly accountCodeFrom?: string;
  /** Inclusive upper bound on `code`. Optional. */
  readonly accountCodeTo?: string;
  /** Skip accounts that have no movement and no opening. */
  readonly hideEmpty?: boolean;
}

export interface GeneralLedgerFilters {
  readonly accountId: string;
  readonly fromDate: string;
  readonly toDate: string;
}

/**
 * `ReportsRepository` — Module 9 wave 1 read-only aggregations over
 * `journal_entry_lines` joined with `journal_entries` (status filter)
 * and `organization_chart_accounts` (label / class).
 *
 * SECURITY: every public method takes `organizationId: TenantId` and
 * scopes every query on `organization_id`. `assertTenantId` runs first
 * so a missing scope crashes with a clear stack rather than leaking
 * cross-tenant data.
 *
 * IMMUTABILITY: only validated entries contribute. Drafts must be
 * validated (or cancelled) before they appear in any report — that is
 * the contract Module 8 enforces via the state machine.
 *
 * Performance: both methods use `getRawMany()` to bypass entity
 * hydration since the output is fully projected. Indexes
 * `ix_journal_entry_lines_org_account` + `ix_journal_entries_org_date`
 * cover the typical access pattern.
 */
@Injectable()
export class ReportsRepository {
  constructor(
    @InjectRepository(JournalEntryLineEntity)
    private readonly lineRepo: Repository<JournalEntryLineEntity>,
  ) {}

  async trialBalance(
    organizationId: TenantId | string,
    filters: TrialBalanceFilters,
  ): Promise<TrialBalanceRow[]> {
    assertTenantId(organizationId);

    // Single query that emits per-account opening (entries strictly
    // before fromDate) + period (entries in [fromDate, toDate]).
    // The GROUP BY is on account; the conditional SUMs partition by
    // date window. Joins are inner so accounts with no movement are
    // naturally excluded (use a separate left-joined query if we
    // ever want "all accounts including zero rows").
    const qb = this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('organization_chart_accounts', 'a', 'a.id = l.account_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date <= :toDate::date`, { toDate: filters.toDate })
      .select('a.id', 'accountId')
      .addSelect('a.code', 'accountCode')
      .addSelect('a.label', 'accountLabel')
      .addSelect('a.class', 'accountClass')
      .addSelect(
        `COALESCE(SUM(CASE WHEN e.entry_date < :fromDate::date THEN l.debit  ELSE 0 END), 0)`,
        'openingDebit',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN e.entry_date < :fromDate::date THEN l.credit ELSE 0 END), 0)`,
        'openingCredit',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN e.entry_date >= :fromDate::date AND e.entry_date <= :toDate::date THEN l.debit  ELSE 0 END), 0)`,
        'periodDebit',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN e.entry_date >= :fromDate::date AND e.entry_date <= :toDate::date THEN l.credit ELSE 0 END), 0)`,
        'periodCredit',
      )
      .setParameter('fromDate', filters.fromDate)
      .groupBy('a.id')
      .addGroupBy('a.code')
      .addGroupBy('a.label')
      .addGroupBy('a.class')
      .orderBy('a.code', 'ASC');

    if (filters.accountClass !== undefined) {
      qb.andWhere('a.class = :accountClass', { accountClass: filters.accountClass });
    }
    if (filters.accountCodeFrom !== undefined) {
      qb.andWhere('a.code >= :codeFrom', { codeFrom: filters.accountCodeFrom });
    }
    if (filters.accountCodeTo !== undefined) {
      qb.andWhere('a.code <= :codeTo', { codeTo: filters.accountCodeTo });
    }

    const rows = await qb.getRawMany<{
      accountId: string;
      accountCode: string;
      accountLabel: string;
      accountClass: string | number;
      openingDebit: string;
      openingCredit: string;
      periodDebit: string;
      periodCredit: string;
    }>();

    return rows.map((r) => {
      const openingD = Number(r.openingDebit);
      const openingC = Number(r.openingCredit);
      const periodD = Number(r.periodDebit);
      const periodC = Number(r.periodCredit);
      const endingD = openingD + periodD;
      const endingC = openingC + periodC;
      const net = endingD - endingC;
      return {
        accountId: r.accountId,
        accountCode: r.accountCode,
        accountLabel: r.accountLabel,
        accountClass: Number(r.accountClass),
        openingDebit: openingD.toFixed(2),
        openingCredit: openingC.toFixed(2),
        periodDebit: periodD.toFixed(2),
        periodCredit: periodC.toFixed(2),
        // Convention SYSCOHADA : présenter le solde du côté naturel ;
        // un compte avec net > 0 est en débit, net < 0 en crédit. Les
        // deux côtés ne sont jamais positifs simultanément à la sortie.
        endingDebit: (net > 0 ? net : 0).toFixed(2),
        endingCredit: (net < 0 ? -net : 0).toFixed(2),
      };
    });
  }

  async generalLedger(
    organizationId: TenantId | string,
    filters: GeneralLedgerFilters,
  ): Promise<GeneralLedgerRow[]> {
    assertTenantId(organizationId);

    const rows = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('journals', 'j', 'j.id = e.journal_id')
      .leftJoin('partner_letterings', 'pl', 'pl.id = l.lettering_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere('l.account_id = :accountId', { accountId: filters.accountId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date >= :fromDate::date AND e.entry_date <= :toDate::date`, {
        fromDate: filters.fromDate,
        toDate: filters.toDate,
      })
      .select('l.id', 'lineId')
      .addSelect('e.id', 'entryId')
      .addSelect(`TO_CHAR(e.entry_date, 'YYYY-MM-DD')`, 'entryDate')
      .addSelect('j.code', 'journalCode')
      .addSelect('e.entry_number', 'entryNumber')
      .addSelect('e.description', 'description')
      .addSelect('l.debit', 'debit')
      .addSelect('l.credit', 'credit')
      .addSelect('pl.lettering_code', 'letteringCode')
      .orderBy('e.entry_date', 'ASC')
      .addOrderBy('e.entry_number', 'ASC')
      .addOrderBy('l.position', 'ASC')
      .getRawMany<{
        lineId: string;
        entryId: string;
        entryDate: string;
        journalCode: string;
        entryNumber: string | number;
        description: string | null;
        debit: string;
        credit: string;
        letteringCode: string | null;
      }>();

    return rows.map((r) => ({
      lineId: r.lineId,
      entryId: r.entryId,
      entryDate: r.entryDate,
      journalCode: r.journalCode,
      entryNumber: Number(r.entryNumber),
      description: r.description,
      debit: Number(r.debit).toFixed(2),
      credit: Number(r.credit).toFixed(2),
      letteringCode: r.letteringCode,
    }));
  }

  /**
   * Cumulative balance "as at" a date — every validated journal-entry
   * line on or before `asAtDate`, grouped per account. Used by the
   * Bilan (balance sheet), which is a snapshot of the org's financial
   * position at a single date, not over a period.
   *
   * Returns one row per account that has had any movement; the service
   * is in charge of normalising the signed `net` into debit / credit
   * columns and of classifying accounts into Bilan sections.
   */
  async accountBalancesAsAt(
    organizationId: TenantId | string,
    asAtDate: string,
  ): Promise<
    Array<{
      accountId: string;
      accountCode: string;
      accountLabel: string;
      accountClass: number;
      totalDebit: string;
      totalCredit: string;
    }>
  > {
    assertTenantId(organizationId);
    const rows = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('organization_chart_accounts', 'a', 'a.id = l.account_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date <= :asAtDate::date`, { asAtDate })
      .select('a.id', 'accountId')
      .addSelect('a.code', 'accountCode')
      .addSelect('a.label', 'accountLabel')
      .addSelect('a.class', 'accountClass')
      .addSelect('COALESCE(SUM(l.debit), 0)', 'totalDebit')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'totalCredit')
      .groupBy('a.id')
      .addGroupBy('a.code')
      .addGroupBy('a.label')
      .addGroupBy('a.class')
      .orderBy('a.code', 'ASC')
      .getRawMany<{
        accountId: string;
        accountCode: string;
        accountLabel: string;
        accountClass: string | number;
        totalDebit: string;
        totalCredit: string;
      }>();

    return rows.map((r) => ({
      accountId: r.accountId,
      accountCode: r.accountCode,
      accountLabel: r.accountLabel,
      accountClass: Number(r.accountClass),
      totalDebit: Number(r.totalDebit).toFixed(2),
      totalCredit: Number(r.totalCredit).toFixed(2),
    }));
  }

  /**
   * Compute the strictly-before-fromDate net balance for one account
   * — i.e. the "opening balance" line shown at the top of the general
   * ledger. Returns { openingDebit, openingCredit }.
   */
  async generalLedgerOpening(
    organizationId: TenantId | string,
    accountId: string,
    fromDate: string,
  ): Promise<{ openingDebit: string; openingCredit: string }> {
    assertTenantId(organizationId);

    const row = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere('l.account_id = :accountId', { accountId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date < :fromDate::date`, { fromDate })
      .select('COALESCE(SUM(l.debit), 0)', 'debit')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'credit')
      .getRawOne<{ debit: string; credit: string }>();

    const d = Number(row?.debit ?? 0);
    const c = Number(row?.credit ?? 0);
    const net = d - c;
    return {
      openingDebit: (net > 0 ? net : 0).toFixed(2),
      openingCredit: (net < 0 ? -net : 0).toFixed(2),
    };
  }
}
