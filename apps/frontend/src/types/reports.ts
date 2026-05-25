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

export type RatioCategory =
  | 'STRUCTURE'
  | 'LIQUIDITE'
  | 'SOLVABILITE'
  | 'RENTABILITE'
  | 'ACTIVITE';

export interface FinancialRatio {
  readonly code: string;
  readonly label: string;
  readonly category: RatioCategory;
  readonly formula: string;
  readonly numerator: string;
  readonly denominator: string;
  readonly value: string | null;
  readonly unit: 'PERCENT' | 'RATIO' | 'DAYS';
  readonly interpretation?: string;
}

export interface FinancialRatiosReport {
  readonly asAtDate: string;
  readonly fiscalYearStartDate: string;
  readonly ratios: ReadonlyArray<FinancialRatio>;
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

export interface SyscohadaPosteAmount {
  readonly code: string;
  readonly label: string;
  readonly side: 'CHARGE' | 'PRODUIT';
  readonly amount: string;
  readonly previousAmount?: string;
}

export interface SoldeIntermediaire {
  readonly code: string;
  readonly label: string;
  readonly formula: string;
  readonly amount: string;
  readonly previousAmount?: string;
  readonly variation?: string;
  readonly variationPercent?: string | null;
}

export interface SigReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly charges: ReadonlyArray<SyscohadaPosteAmount>;
  readonly produits: ReadonlyArray<SyscohadaPosteAmount>;
  readonly soldes: ReadonlyArray<SoldeIntermediaire>;
  readonly previous?: {
    readonly fromDate: string;
    readonly toDate: string;
  };
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
