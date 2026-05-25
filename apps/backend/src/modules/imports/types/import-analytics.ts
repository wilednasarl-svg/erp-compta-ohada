/**
 * `ImportAnalytics` — shape de réponse de `ImportAnalyticsService.compute`.
 *
 * Toutes les valeurs monétaires sont des strings décimales pour
 * traverser JSON sans perte (les staging entries portent déjà les
 * montants en string, on conserve cette convention).
 *
 * La donnée est calculée à la volée depuis `import_staging_entries`,
 * pas snapshot. Pour une session de 50k lignes la requête reste sous
 * les 200ms (toutes les colonnes utiles sont dans le JSONB
 * `mapped_values` et l'index `(session_id, row_number)` couvre le
 * scan).
 */
export interface ImportAnalytics {
  readonly sessionId: string;
  readonly organizationId: string;
  readonly currency: string; // implicit XOF for now
  readonly kpis: ImportAnalyticsKpis;
  readonly daily: ReadonlyArray<ImportAnalyticsDailyPoint>;
  readonly byJournal: ReadonlyArray<ImportAnalyticsJournalRow>;
  readonly topAccounts: ReadonlyArray<ImportAnalyticsAccountRow>;
  readonly byAccountClass: ReadonlyArray<ImportAnalyticsClassRow>;
  readonly errorBreakdown: ReadonlyArray<ImportAnalyticsErrorRow>;
}

export interface ImportAnalyticsKpis {
  readonly totalLines: number;
  readonly validLines: number;
  readonly errorLines: number;
  readonly validRatePercent: number; // 0..100
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly netBalance: string; // debit - credit
  readonly isBalanced: boolean; // |netBalance| < 0.01
  readonly periodStart: string | null; // ISO YYYY-MM-DD or null
  readonly periodEnd: string | null;
  readonly distinctJournals: number;
  readonly distinctAccounts: number;
  readonly distinctPartners: number;
}

export interface ImportAnalyticsDailyPoint {
  readonly date: string; // ISO YYYY-MM-DD
  readonly debit: string;
  readonly credit: string;
  readonly net: string;
  readonly lines: number;
}

export interface ImportAnalyticsJournalRow {
  readonly journal: string;
  readonly debit: string;
  readonly credit: string;
  readonly total: string; // debit + credit (volume)
  readonly lines: number;
}

export interface ImportAnalyticsAccountRow {
  readonly account: string;
  readonly debit: string;
  readonly credit: string;
  readonly movement: string; // |debit - credit|
  readonly lines: number;
}

export interface ImportAnalyticsClassRow {
  readonly accountClass: string; // '1'..'9' or 'autre'
  readonly classLabel: string; // libellé SYSCOHADA
  readonly debit: string;
  readonly credit: string;
  readonly lines: number;
}

export interface ImportAnalyticsErrorRow {
  readonly code: string; // ValidationErrorCode
  readonly count: number;
  readonly sharePercent: number; // % of total lines
}
