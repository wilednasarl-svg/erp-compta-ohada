/**
 * Types miroir des réponses backend Module 19 Dashboards. Voir
 * apps/backend/src/modules/dashboards/types/dashboard-types.ts
 *
 * Convention : montants DECIMAL en string côté wire pour préserver
 * la précision OHADA. Convert via Number() uniquement pour formatage.
 */

export type AgingType = 'clients' | 'fournisseurs';
export type AgingBucket = '0-30' | '31-60' | '61-90' | 'over-90';

export const AGING_BUCKETS: readonly AgingBucket[] = [
  '0-30',
  '31-60',
  '61-90',
  'over-90',
] as const;

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  '0-30': '0–30 jours',
  '31-60': '31–60 jours',
  '61-90': '61–90 jours',
  'over-90': 'Plus de 90 jours',
};

export interface AccountClassBreakdown {
  readonly accountClass: number;
  readonly label: string;
  readonly debit: string;
  readonly credit: string;
  readonly net: string;
}

export interface DashboardSummary {
  readonly organizationId: string;
  readonly exerciseId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
  readonly cashBalance: string;
  readonly receivables: string;
  readonly payables: string;
  readonly revenueYtd: string;
  readonly expensesYtd: string;
  readonly netResultYtd: string;
  readonly grossMarginRatio: number | null;
  readonly liquidityRatio: number | null;
  readonly accountClassBreakdown: ReadonlyArray<AccountClassBreakdown>;
}

export interface AgingBucketSummary {
  readonly bucket: AgingBucket;
  readonly minDays: number;
  readonly maxDays: number | null;
  readonly amount: string;
  readonly lineCount: number;
}

export interface PartnerAgingRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly totalOutstanding: string;
  readonly amountsByBucket: Readonly<Record<AgingBucket, string>>;
}

export interface DashboardAging {
  readonly organizationId: string;
  readonly type: AgingType;
  readonly asOfDate: string;
  readonly currency: string;
  readonly buckets: ReadonlyArray<AgingBucketSummary>;
  readonly totalOutstanding: string;
  readonly partnerBreakdown: ReadonlyArray<PartnerAgingRow>;
}
