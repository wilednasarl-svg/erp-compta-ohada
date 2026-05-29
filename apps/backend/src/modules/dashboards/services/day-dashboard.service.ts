import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';

export interface DaySummaryPending {
  readonly entries: number;
  readonly bankLines: number;
  readonly auxLettering: number;
  readonly tvaDeclarations: number;
}

export interface DaySummaryActivity {
  readonly module: string;
  readonly action: string;
  readonly entityType: string | null;
  readonly createdAt: string;
}

export interface DaySummary {
  readonly pending: DaySummaryPending;
  readonly exercise: {
    readonly id: string;
    readonly label: string;
    readonly startDate: string;
    readonly endDate: string;
  } | null;
  readonly activePeriod: { readonly label: string; readonly endDate: string } | null;
  readonly entriesThisMonth: number;
  readonly pendingThisMonth: number;
  readonly score: { readonly value: number; readonly grade: string } | null;
  readonly recentActivity: readonly DaySummaryActivity[];
}

@Injectable()
export class DayDashboardService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async getDaySummary(organizationId: TenantId): Promise<DaySummary> {
    assertTenantId(organizationId);
    const id = organizationId as string;

    const [
      pendingEntriesRows,
      unmatchedBankRows,
      unletteredAuxRows,
      pendingTvaRows,
      exerciseRows,
      activePeriodRows,
      entriesMonthRows,
      pendingMonthRows,
      scoreRows,
      activityRows,
    ] = await Promise.all([
      this.ds.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count
         FROM journal_entries
         WHERE organization_id = $1 AND status = 'draft'`,
        [id],
      ),
      this.ds.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count
         FROM bank_statement_lines
         WHERE organization_id = $1 AND match_status = 'unmatched'`,
        [id],
      ),
      this.ds.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count
         FROM journal_entry_lines l
         INNER JOIN organization_chart_accounts a ON a.id = l.account_id
         WHERE l.organization_id = $1
           AND l.lettering_id IS NULL
           AND (a.code LIKE '40%' OR a.code LIKE '41%')`,
        [id],
      ),
      this.ds.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count
         FROM tva_declarations
         WHERE organization_id = $1 AND status IN ('draft', 'calculated')`,
        [id],
      ),
      this.ds.query<Array<{ id: string; label: string; start_date: string; end_date: string }>>(
        `SELECT id, label, start_date, end_date
         FROM accounting_periods
         WHERE organization_id = $1 AND kind = 'ANNUAL' AND status = 'open'
         ORDER BY start_date DESC LIMIT 1`,
        [id],
      ),
      this.ds.query<Array<{ label: string; end_date: string }>>(
        `SELECT label, end_date
         FROM accounting_periods
         WHERE organization_id = $1 AND kind = 'MONTHLY' AND status = 'open'
         ORDER BY end_date ASC LIMIT 1`,
        [id],
      ),
      this.ds.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count
         FROM journal_entries
         WHERE organization_id = $1
           AND status = 'validated'
           AND date_trunc('month', entry_date) = date_trunc('month', CURRENT_DATE)`,
        [id],
      ),
      this.ds.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count
         FROM journal_entries
         WHERE organization_id = $1
           AND status = 'draft'
           AND date_trunc('month', entry_date) = date_trunc('month', CURRENT_DATE)`,
        [id],
      ),
      this.ds.query<Array<{ score: number; grade: string }>>(
        `SELECT score, grade
         FROM accounting_scores
         WHERE organization_id = $1
         ORDER BY calculated_at DESC LIMIT 1`,
        [id],
      ),
      this.ds.query<
        Array<{ module: string; action: string; entity_type: string | null; created_at: string }>
      >(
        `SELECT module, action, entity_type, created_at
         FROM auth_events
         WHERE organization_id = $1
         ORDER BY created_at DESC LIMIT 6`,
        [id],
      ),
    ]);

    const ex = exerciseRows[0];
    const ap = activePeriodRows[0];
    const sc = scoreRows[0];

    return {
      pending: {
        entries: toInt(pendingEntriesRows[0]?.count),
        bankLines: toInt(unmatchedBankRows[0]?.count),
        auxLettering: toInt(unletteredAuxRows[0]?.count),
        tvaDeclarations: toInt(pendingTvaRows[0]?.count),
      },
      exercise: ex
        ? { id: ex.id, label: ex.label, startDate: ex.start_date, endDate: ex.end_date }
        : null,
      activePeriod: ap ? { label: ap.label, endDate: ap.end_date } : null,
      entriesThisMonth: toInt(entriesMonthRows[0]?.count),
      pendingThisMonth: toInt(pendingMonthRows[0]?.count),
      score: sc ? { value: sc.score, grade: sc.grade } : null,
      recentActivity: activityRows.map((r) => ({
        module: r.module,
        action: r.action,
        entityType: r.entity_type,
        createdAt: r.created_at,
      })),
    };
  }
}

function toInt(value: string | undefined): number {
  return value !== undefined ? parseInt(value, 10) : 0;
}
