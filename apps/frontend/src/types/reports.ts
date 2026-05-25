/**
 * Types miroir du module backend `reports` (Module 9 wave 1).
 *   apps/backend/src/modules/reports/services/reports.service.ts
 *
 * Convention DECIMAL(15,2) : tous les montants traversent le réseau en
 * `string` pour préserver la précision (pas de Number côté JSON).
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

export interface TrialBalanceTotals {
  readonly openingDebit: string;
  readonly openingCredit: string;
  readonly periodDebit: string;
  readonly periodCredit: string;
  readonly endingDebit: string;
  readonly endingCredit: string;
}

export interface TrialBalanceReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly rows: ReadonlyArray<TrialBalanceRow>;
  readonly totals: TrialBalanceTotals;
}

export interface ComparativeBalanceRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly accountClass: number;
  readonly previousPeriodDebit: string;
  readonly previousPeriodCredit: string;
  readonly periodDebit: string;
  readonly periodCredit: string;
  readonly endingDebit: string;
  readonly endingCredit: string;
  readonly netVariation: string;
  readonly netVariationPercent: string | null;
}

export interface ComparativeBalanceTotals {
  readonly previousPeriodDebit: string;
  readonly previousPeriodCredit: string;
  readonly periodDebit: string;
  readonly periodCredit: string;
  readonly endingDebit: string;
  readonly endingCredit: string;
}

export interface ComparativeBalanceReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly previousFromDate: string;
  readonly previousToDate: string;
  readonly rows: ReadonlyArray<ComparativeBalanceRow>;
  readonly totals: ComparativeBalanceTotals;
}

export interface GeneralLedgerLine {
  readonly lineId: string;
  readonly entryId: string;
  readonly entryDate: string;
  readonly journalCode: string;
  readonly entryNumber: number;
  readonly description: string | null;
  readonly debit: string;
  readonly credit: string;
  readonly letteringCode: string | null;
  readonly runningBalance: string;
}

export interface GeneralLedgerReport {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly accountClass: number;
  readonly fromDate: string;
  readonly toDate: string;
  readonly opening: {
    readonly openingDebit: string;
    readonly openingCredit: string;
  };
  readonly lines: ReadonlyArray<GeneralLedgerLine>;
  readonly totals: {
    readonly periodDebit: string;
    readonly periodCredit: string;
    readonly endingDebit: string;
    readonly endingCredit: string;
  };
}
