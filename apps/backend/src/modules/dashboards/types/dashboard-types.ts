/**
 * Types miroir des réponses Dashboards (Module 19 wave 1).
 *
 * Convention de sérialisation : montants en `string` DECIMAL pour
 * préserver la précision OHADA (DECIMAL(15,2)) sans drift float JS,
 * même pattern que `reports`. Le frontend formate via toLocaleString.
 *
 * Pas de PNG/PDF en wave 1 — la réponse JSON est consommée directement
 * par Recharts / Chart.js côté Next.js.
 */

export type AgingType = 'clients' | 'fournisseurs';

export type AgingBucket = '0-30' | '31-60' | '61-90' | 'over-90';

export const AGING_BUCKETS: readonly AgingBucket[] = ['0-30', '31-60', '61-90', 'over-90'];

/** Résumé "overview" : un objet par exercice, agrège YTD + soldes instantanés. */
export interface DashboardSummary {
  readonly organizationId: string;
  /** ID accounting_period racine (exercice annuel). */
  readonly exerciseId: string;
  /** Bornes effectives utilisées (= startDate/endDate de l'exercice). */
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;

  /** Snapshot — soldes instantanés au `periodEnd`. */
  readonly cashBalance: string; // DECIMAL string : net débit classe 5x trésorerie
  readonly receivables: string; // net débit classe 41x clients
  readonly payables: string; // net crédit classe 40x fournisseurs

  /** YTD — flux cumulés depuis le début de l'exercice. */
  readonly revenueYtd: string; // net crédit classe 7x produits
  readonly expensesYtd: string; // net débit classe 6x charges
  readonly netResultYtd: string; // revenue - expense (signed)

  /** Ratios (informationnels, calculés en service). */
  readonly grossMarginRatio: number | null; // (revenue - expenses) / revenue
  readonly liquidityRatio: number | null; // cash / payables — null si payables = 0

  /** Pour drill-down ultérieur. */
  readonly accountClassBreakdown: ReadonlyArray<AccountClassBreakdown>;
}

export interface AccountClassBreakdown {
  readonly accountClass: number; // 1-9 OHADA
  readonly label: string; // "Trésorerie", "Clients"…
  readonly debit: string;
  readonly credit: string;
  readonly net: string; // debit - credit (signed)
}

/** Aging : montants par bucket d'ancienneté pour clients OU fournisseurs. */
export interface DashboardAging {
  readonly organizationId: string;
  readonly type: AgingType;
  readonly asOfDate: string;
  readonly currency: string;
  readonly buckets: ReadonlyArray<AgingBucketSummary>;
  readonly totalOutstanding: string;
  readonly partnerBreakdown: ReadonlyArray<PartnerAgingRow>;
}

export interface AgingBucketSummary {
  readonly bucket: AgingBucket;
  readonly minDays: number;
  /** null = open upper bound (>90). */
  readonly maxDays: number | null;
  readonly amount: string;
  readonly lineCount: number;
}

export interface PartnerAgingRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly totalOutstanding: string;
  /** Distribution par bucket (somme = totalOutstanding). */
  readonly amountsByBucket: Readonly<Record<AgingBucket, string>>;
}
