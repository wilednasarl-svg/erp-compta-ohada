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

// ─────────────────────────────────────────────────────────────────────
// Wave 2 — Time-series analytics + top accounts (drill-down)
// ─────────────────────────────────────────────────────────────────────

/**
 * Un point de série temporelle cashflow mensuel.
 *
 *   - `periodStart` / `periodEnd` : bornes du mois (ISO date).
 *   - `label` : libellé court "Mar 2026" pour XAxis Recharts.
 *   - `inflow` : SUM debit sur comptes 51/53/57 dans la fenêtre.
 *   - `outflow` : SUM credit sur ces mêmes comptes.
 *   - `netFlow` : inflow - outflow (positif = encaissement net).
 *   - `closingBalance` : solde cumulatif depuis le début de
 *     l'exercice (utile pour une AreaChart "courbe d'évolution").
 */
export interface MonthlyCashflowPoint {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly label: string;
  readonly inflow: string;
  readonly outflow: string;
  readonly netFlow: string;
  readonly closingBalance: string;
}

export interface DashboardCashflow {
  readonly organizationId: string;
  readonly exerciseId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
  readonly points: ReadonlyArray<MonthlyCashflowPoint>;
  readonly totals: {
    readonly inflow: string;
    readonly outflow: string;
    readonly netFlow: string;
  };
}

/**
 * Évolution mensuelle Produits / Charges / Résultat. Utilisé pour un
 * BarChart double + LineChart résultat superposé côté UI.
 */
export interface MonthlyPnlPoint {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly label: string;
  readonly revenue: string;
  readonly expenses: string;
  readonly netResult: string;
}

export interface DashboardEvolution {
  readonly organizationId: string;
  readonly exerciseId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
  readonly points: ReadonlyArray<MonthlyPnlPoint>;
  readonly totals: {
    readonly revenue: string;
    readonly expenses: string;
    readonly netResult: string;
  };
}

/**
 * Catégorie supportée par `GET /top-accounts`. Détermine la classe
 * OHADA filtrée et le sens "naturel" du tri :
 *   - 'expenses' : classe 6, tri par net débit desc.
 *   - 'revenue'  : classe 7, tri par net crédit desc.
 */
export type TopAccountCategory = 'expenses' | 'revenue';

export interface TopAccountRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  /** Montant absolu (toujours positif) dans le sens naturel de la catégorie. */
  readonly amount: string;
  /** Part en pourcentage du total catégorie (0-100, 1 décimale). */
  readonly sharePercent: number;
}

export interface DashboardTopAccounts {
  readonly organizationId: string;
  readonly exerciseId: string;
  readonly category: TopAccountCategory;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
  readonly totalAmount: string;
  readonly rows: ReadonlyArray<TopAccountRow>;
}
