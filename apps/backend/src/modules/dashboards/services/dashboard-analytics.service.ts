import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import { DashboardsRepository } from '../repositories/dashboards.repository';
import type {
  DashboardCashflow,
  DashboardEvolution,
  DashboardTopAccounts,
  MonthlyCashflowPoint,
  MonthlyPnlPoint,
  TopAccountCategory,
  TopAccountRow,
} from '../types/dashboard-types';

/**
 * `DashboardAnalyticsService` — Module 19 wave 2.
 *
 * Étend le summary/aging de wave 1 avec :
 *   - cashflow mensuel (séries temporelles inflow/outflow + cumul),
 *   - évolution P&L mensuelle (produits / charges / résultat),
 *   - top-N comptes par flux dans une catégorie (charges ou produits).
 *
 * Tous les endpoints sont scoped sur un exercice racine (parentId
 * IS NULL) — la fenêtre d'analyse est `[period.startDate, period.endDate]`.
 *
 * Pivot mensuel : le repo renvoie uniquement les mois qui ont eu
 * de l'activité. Le service complète avec des points zéro pour les
 * mois manquants (Recharts attend une série continue pour des
 * échelles propres). On itère du `startDate` au `endDate` par pas
 * mensuel et on associe ou pas un row du repo.
 */
@Injectable()
export class DashboardAnalyticsService {
  constructor(
    private readonly dashRepo: DashboardsRepository,
    private readonly periodsRepo: AccountingPeriodRepository,
  ) {}

  async getCashflow(organizationId: TenantId, exerciseId: string): Promise<DashboardCashflow> {
    const period = await this.requireRootPeriod(organizationId, exerciseId);

    const rows = await this.dashRepo.monthlyAggregateByCodePrefix(
      organizationId,
      period.startDate,
      period.endDate,
      ['51', '53', '57'],
    );

    // Index des rows par 1er-jour-du-mois pour lookup O(1) pendant
    // l'expansion en série continue.
    const byMonth = new Map<string, (typeof rows)[number]>();
    for (const r of rows) byMonth.set(monthKey(r.month), r);

    const months = listMonths(period.startDate, period.endDate);
    let cumulative = 0;
    const points: MonthlyCashflowPoint[] = months.map((m) => {
      const row = byMonth.get(monthKey(m.start));
      const inflow = row ? Number(row.totalDebit) : 0;
      const outflow = row ? Number(row.totalCredit) : 0;
      const netFlow = inflow - outflow;
      cumulative += netFlow;
      return {
        periodStart: m.start,
        periodEnd: m.end,
        label: m.label,
        inflow: inflow.toFixed(2),
        outflow: outflow.toFixed(2),
        netFlow: netFlow.toFixed(2),
        closingBalance: cumulative.toFixed(2),
      };
    });

    const totalInflow = points.reduce((s, p) => s + Number(p.inflow), 0);
    const totalOutflow = points.reduce((s, p) => s + Number(p.outflow), 0);
    return {
      organizationId,
      exerciseId,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      currency: 'XOF',
      points,
      totals: {
        inflow: totalInflow.toFixed(2),
        outflow: totalOutflow.toFixed(2),
        netFlow: (totalInflow - totalOutflow).toFixed(2),
      },
    };
  }

  async getEvolution(
    organizationId: TenantId,
    exerciseId: string,
  ): Promise<DashboardEvolution> {
    const period = await this.requireRootPeriod(organizationId, exerciseId);

    const rows = await this.dashRepo.monthlyAggregateByClass(
      organizationId,
      period.startDate,
      period.endDate,
      [6, 7],
    );

    // Index (month, class) → row.
    const byMonthClass = new Map<string, (typeof rows)[number]>();
    for (const r of rows) byMonthClass.set(`${monthKey(r.month)}:${r.accountClass}`, r);

    const months = listMonths(period.startDate, period.endDate);
    const points: MonthlyPnlPoint[] = months.map((m) => {
      const mk = monthKey(m.start);
      const revenueRow = byMonthClass.get(`${mk}:7`);
      const expenseRow = byMonthClass.get(`${mk}:6`);
      const revenue = revenueRow
        ? Number(revenueRow.totalCredit) - Number(revenueRow.totalDebit)
        : 0;
      const expenses = expenseRow
        ? Number(expenseRow.totalDebit) - Number(expenseRow.totalCredit)
        : 0;
      return {
        periodStart: m.start,
        periodEnd: m.end,
        label: m.label,
        revenue: revenue.toFixed(2),
        expenses: expenses.toFixed(2),
        netResult: (revenue - expenses).toFixed(2),
      };
    });

    const totalRevenue = points.reduce((s, p) => s + Number(p.revenue), 0);
    const totalExpenses = points.reduce((s, p) => s + Number(p.expenses), 0);
    return {
      organizationId,
      exerciseId,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      currency: 'XOF',
      points,
      totals: {
        revenue: totalRevenue.toFixed(2),
        expenses: totalExpenses.toFixed(2),
        netResult: (totalRevenue - totalExpenses).toFixed(2),
      },
    };
  }

  async getTopAccounts(
    organizationId: TenantId,
    input: { exerciseId: string; category: TopAccountCategory; limit?: number },
  ): Promise<DashboardTopAccounts> {
    const period = await this.requireRootPeriod(organizationId, input.exerciseId);
    const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
    const accountClass = input.category === 'expenses' ? 6 : 7;

    const flows = await this.dashRepo.accountFlowsByClass(
      organizationId,
      period.startDate,
      period.endDate,
      accountClass,
    );

    // Sens du tri : charges = débit naturel, produits = crédit naturel.
    // On calcule un "amount" positif unifié dans le sens naturel pour
    // que le client n'ait pas à connaître la convention SYSCOHADA.
    const enriched = flows
      .map((f) => {
        const debit = Number(f.totalDebit);
        const credit = Number(f.totalCredit);
        const amount =
          input.category === 'expenses' ? debit - credit : credit - debit;
        return { ...f, amount };
      })
      .filter((f) => f.amount > 0); // skip comptes contre-passés à 0 ou négatifs

    enriched.sort((a, b) => b.amount - a.amount);
    const top = enriched.slice(0, limit);

    const totalAmount = enriched.reduce((s, r) => s + r.amount, 0);
    const rows: TopAccountRow[] = top.map((r) => ({
      accountId: r.accountId,
      accountCode: r.accountCode,
      accountLabel: r.accountLabel,
      amount: r.amount.toFixed(2),
      sharePercent: totalAmount > 0 ? round1((r.amount / totalAmount) * 100) : 0,
    }));

    return {
      organizationId,
      exerciseId: input.exerciseId,
      category: input.category,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      currency: 'XOF',
      totalAmount: totalAmount.toFixed(2),
      rows,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private async requireRootPeriod(organizationId: TenantId, exerciseId: string) {
    const period = await this.periodsRepo.findById(exerciseId, organizationId);
    if (period === null || period.parentId !== null) {
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_NOT_FOUND, {
        message: `Exercise ${exerciseId} not found or is not a root annual period`,
      });
    }
    return period;
  }
}

/** ISO YYYY-MM-DD → YYYY-MM (clé d'index). */
function monthKey(d: string): string {
  return d.slice(0, 7);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Énumère les mois entre `fromIso` et `toIso` (inclus). Génère pour
 * chaque mois :
 *   - start : YYYY-MM-01 (ISO)
 *   - end   : dernier jour du mois (ISO)
 *   - label : "Janv. 2026" en français court pour les axes Recharts.
 */
export function listMonths(
  fromIso: string,
  toIso: string,
): Array<{ start: string; end: string; label: string }> {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (from > to) return [];

  const out: Array<{ start: string; end: string; label: string }> = [];
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const endStop = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));

  while (cursor <= endStop) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const lastDay = new Date(Date.UTC(y, m + 1, 0)); // 0e jour du mois suivant = dernier du courant
    out.push({
      start: toIso2(cursor),
      end: toIso2(lastDay),
      label: monthLabelFr(cursor),
    });
    cursor = new Date(Date.UTC(y, m + 1, 1));
  }
  return out;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function toIso2(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MONTH_LABELS_FR = [
  'Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin',
  'Juill.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.',
];

function monthLabelFr(d: Date): string {
  return `${MONTH_LABELS_FR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
