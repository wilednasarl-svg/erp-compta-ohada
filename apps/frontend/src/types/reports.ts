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

export interface OhadaStatementLine {
  readonly code: string;
  readonly label: string;
  readonly amount: string;
  readonly note?: string;
}

export interface OhadaStatementSection {
  readonly code: string;
  readonly label: string;
  readonly lines: ReadonlyArray<OhadaStatementLine>;
  readonly total: string;
}

/**
 * @deprecated Conservé pour compat ascendante de panels annexes le
 * temps que tous les consommateurs migrent vers `CashFlowReport`
 * (vague A — codes Z Tome 3 p.34). Le panel TFT principal consomme
 * désormais `CashFlowReport`.
 */
export interface TftReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly fluxExploitation: OhadaStatementSection;
  readonly fluxInvestissement: OhadaStatementSection;
  readonly fluxFinancement: OhadaStatementSection;
  readonly variationTresorerie: string;
  readonly tresorerieOuverture: string;
  readonly tresorerieCloture: string;
  readonly methodologyNotes: ReadonlyArray<string>;
}

// ─── TFT — Cash Flow Report (SYSCOHADA Tome 3 p.34, codes Z) ──────────
//
// Nomenclature officielle (doctrine OHADA Révisé) :
//   ZA = trésorerie nette au 1er janvier (ouverture)
//   ZB = sous-total flux opérationnels         (somme FA…FE)
//   ZC = sous-total flux d'investissement      (somme FF…FJ)
//   ZD = sous-total financement capitaux propres (somme FK…FN)
//   ZE = sous-total financement capitaux étrangers (somme FO…FQ)
//   ZF = total financement                     (ZD + ZE)
//   ZG = variation totale de trésorerie        (ZB + ZC + ZF)
//   ZH = trésorerie nette au 31 décembre       (ZA + ZG)

export interface CashFlowPoste {
  /** Code poste à 2 lettres : `FA`, `FB`, …, `FQ`. */
  readonly code: string;
  readonly label: string;
  /** DECIMAL string ; signe conservé (peut être négatif). */
  readonly amount: string;
  /** Description courte de la formule de calcul, pour traçabilité. */
  readonly source?: string;
}

/** Sous-section regroupant des postes de détail + un sous-total Z. */
export interface CashFlowSection {
  readonly code: 'ZB' | 'ZC' | 'ZD' | 'ZE';
  readonly label: string;
  readonly postes: ReadonlyArray<CashFlowPoste>;
  readonly subtotal: string;
}

/**
 * Résumé période N-1 — exposé en colonne comparatif. Détail poste par
 * poste non requis par la doctrine pour N-1 ; seuls les agrégats Z.
 */
export interface CashFlowPreviousSummary {
  readonly fromDate: string;
  readonly toDate: string;
  readonly openingCash: string;          // ZA
  readonly closingCash: string;          // ZH
  readonly netCashVariation: string;     // ZG
  readonly operatingFlow: string;        // ZB
  readonly investingFlow: string;        // ZC
  readonly financingFlowEquity: string;  // ZD
  readonly financingFlowDebt: string;    // ZE
  readonly financingFlowTotal: string;   // ZF
}

/**
 * Rapport TFT conforme SYSCOHADA Révisé Tome 3 page 34.
 * Miroir du backend `CashFlowReport` (cash-flow.service.ts).
 */
export interface CashFlowReport {
  readonly fromDate: string;
  readonly toDate: string;
  /** ZA — Trésorerie nette à l'ouverture. */
  readonly openingCash: string;
  /** Section ZB : flux opérationnels (FA-FE). */
  readonly operatingFlows: CashFlowSection;
  /** Section ZC : flux d'investissement (FF-FJ). */
  readonly investingFlows: CashFlowSection;
  /** Section ZD : flux financement capitaux propres (FK-FN). */
  readonly financingFlowsEquity: CashFlowSection;
  /** Section ZE : flux financement capitaux étrangers (FO-FQ). */
  readonly financingFlowsDebt: CashFlowSection;
  /** ZF — financement total (= ZD + ZE). */
  readonly financingFlowsTotal: string;
  /** ZG — variation totale (= ZB + ZC + ZF). */
  readonly netCashVariation: string;
  /** ZH — Trésorerie nette à la clôture (= ZA + ZG). */
  readonly closingCash: string;
  /**
   * |ZH − trésorerie nette comptes classe 5 à toDate|. Doit ≈ 0 sur
   * des données saines. > 1 FCFA → défaut de mapping.
   */
  readonly coherenceCheck: string;
  readonly previous?: CashFlowPreviousSummary;
}

export interface AnnexeNote {
  readonly code: string;
  readonly title: string;
  readonly status: 'COMPUTED' | 'PARTIAL' | 'MANUAL';
  readonly source?: string;
  readonly summary?: string;
}

export interface AnnexeReport {
  readonly asAtDate: string;
  readonly fiscalYearStartDate: string;
  readonly notes: ReadonlyArray<AnnexeNote>;
}

// ─── Import diagnostic ──────────────────────────────────────────────

export type ImportAnomalySeverity = 'critical' | 'warning' | 'info';

export interface ImportTrialBalanceRow {
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly debit: string;
  readonly credit: string;
  readonly balance: string;
  readonly sign: 'D' | 'C' | '=';
  readonly lineCount: number;
  readonly accountExists: boolean;
  readonly autoProvisionable: boolean;
}

export interface ImportAnomalySample {
  readonly rowNumber: number;
  readonly accountCode: string | null;
  readonly field?: string;
  readonly message: string;
}

export interface ImportAnomalyGroup {
  readonly code: string;
  readonly severity: ImportAnomalySeverity;
  readonly title: string;
  readonly description: string;
  readonly count: number;
  readonly samples: ReadonlyArray<ImportAnomalySample>;
}

export interface ImportRemediationItem {
  readonly priority: 1 | 2 | 3;
  readonly title: string;
  readonly description: string;
  readonly autoFixable: boolean;
  readonly affectedCount: number;
}

export interface ImportDiagnosticReport {
  readonly session: {
    readonly id: string;
    readonly label: string | null;
    readonly status: string;
    readonly sourceType: string;
    readonly documentType: string | null;
    readonly totalLines: number;
    readonly errorLines: number;
    readonly createdAt: string;
  };
  readonly trialBalance: ReadonlyArray<ImportTrialBalanceRow>;
  readonly totals: {
    readonly totalDebit: string;
    readonly totalCredit: string;
    readonly balanceDelta: string;
    readonly isBalanced: boolean;
  };
  readonly anomalies: {
    readonly critical: ReadonlyArray<ImportAnomalyGroup>;
    readonly warnings: ReadonlyArray<ImportAnomalyGroup>;
    readonly info: ReadonlyArray<ImportAnomalyGroup>;
  };
  readonly remediationPlan: ReadonlyArray<ImportRemediationItem>;
  readonly verdict: {
    readonly status: 'conforme' | 'à corriger' | 'bloquant';
    readonly criticalCount: number;
    readonly warningCount: number;
    readonly infoCount: number;
    readonly canCommit: boolean;
  };
}

/** Réponse `GET /imports/sessions` côté frontend. */
export interface ImportSessionSummary {
  readonly id: string;
  readonly status: string;
  readonly sourceType: string;
  readonly label: string | null;
  readonly totalLines: number;
  readonly errorLines: number;
  readonly createdAt: string;
  readonly documentType: string | null;
}

export interface AnnexeNoteDetailRow {
  readonly code: string;
  readonly label: string;
  readonly amount: string;
  readonly subRows?: ReadonlyArray<AnnexeNoteDetailRow>;
}

export interface AnnexeNoteDetailReport {
  readonly noteCode: string;
  readonly title: string;
  readonly asAtDate: string;
  readonly fiscalYearStartDate: string;
  readonly rows: ReadonlyArray<AnnexeNoteDetailRow>;
  readonly total: string;
  readonly coverage: 'COMPLETE' | 'PARTIAL' | 'UNSUPPORTED';
  readonly methodology?: string;
}

export interface AnalyticAxisSummary {
  readonly axisType: string;
  readonly axisCode: string;
  readonly lineCount: number;
}

export interface MarginByAxisRow {
  readonly axisCode: string;
  readonly chiffreAffaires: string;
  readonly achatsConsommes: string;
  readonly margeBrute: string;
  readonly margeBrutePercent: string | null;
  readonly chargesPersonnel: string;
  readonly autresCharges: string;
  readonly resultatNet: string;
}

export interface MarginByAxisReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly axisType: string;
  readonly rows: ReadonlyArray<MarginByAxisRow>;
  readonly totals: MarginByAxisRow;
}

export type AgingSide = 'CLIENT' | 'FOURNISSEUR';

export interface AgingBucket {
  readonly upperDays: number | null;
  readonly label: string;
  readonly amount: string;
}

export interface AgingAccountRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly total: string;
  readonly buckets: ReadonlyArray<AgingBucket>;
}

export interface AgingBalanceReport {
  readonly side: AgingSide;
  readonly asAtDate: string;
  readonly bucketBoundaries: ReadonlyArray<number>;
  readonly rows: ReadonlyArray<AgingAccountRow>;
  readonly bucketTotals: ReadonlyArray<string>;
  readonly grandTotal: string;
}

export interface MultiYearPeriod {
  readonly fromDate: string;
  readonly toDate: string;
}

export interface MultiYearBalanceRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly accountClass: number;
  readonly netByPeriod: ReadonlyArray<string>;
  readonly endingDebit: string;
  readonly endingCredit: string;
}

export interface MultiYearBalanceReport {
  readonly periods: ReadonlyArray<MultiYearPeriod>;
  readonly rows: ReadonlyArray<MultiYearBalanceRow>;
}

export interface CashTrendPoint {
  readonly yearMonth: string;
  readonly asAtDate: string;
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly netCash: string;
  readonly change: string | null;
}

export interface CashTrendReport {
  readonly fromMonth: string;
  readonly toMonth: string;
  readonly points: ReadonlyArray<CashTrendPoint>;
  readonly currentNetCash: string;
  readonly minNetCash: string;
  readonly maxNetCash: string;
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

// ─── Bilan OHADA (SYSCOHADA AUDCIF) ────────────────────────────────────
//
// Hiérarchie officielle 3 niveaux conforme DSF :
//   masse → rubrique → poste lettré (35 postes AD-BZ actif, CA-DZ passif)

export interface BilanPoste {
  readonly code: string;
  readonly label: string;
  readonly side: 'ACTIF' | 'PASSIF';
  readonly net: string;
  readonly brut?: string;
  readonly deduction?: string;
  readonly netPrevious?: string;
  readonly netChange?: string;
}

export interface BilanRubrique {
  readonly label: string;
  readonly postes: ReadonlyArray<BilanPoste>;
  readonly subtotal: string;
  readonly subtotalPrevious?: string;
}

export interface BilanMasse {
  readonly code: string;
  readonly label: string;
  readonly rubriques: ReadonlyArray<BilanRubrique>;
  readonly total: string;
  readonly totalPrevious?: string;
}

export interface BalanceSheetPreviousSummary {
  readonly asAtDate: string;
  readonly totalActif: string;
  readonly totalPassif: string;
  readonly difference: string;
}

export interface BalanceSheetReport {
  readonly asAtDate: string;
  readonly actifMasses: ReadonlyArray<BilanMasse>;
  readonly passifMasses: ReadonlyArray<BilanMasse>;
  readonly unclassified: ReadonlyArray<BilanPoste>;
  readonly totals: {
    readonly actif: string;
    readonly passif: string;
    /** actif − passif. Doit être ~0 sur un bilan équilibré. */
    readonly difference: string;
  };
  readonly netResultIncorporated: string | null;
  /** Alias historique de `totals.difference`. */
  readonly difference: string;
  readonly previous?: BalanceSheetPreviousSummary;
}

// ─── Compte de Résultat OHADA (présentation charges/produits) ─────────

export interface ProfitLossAccountLine {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly amount: string;
}

export interface ProfitLossLine {
  readonly code: string;
  readonly label: string;
  readonly amount: string;
  readonly previousAmount?: string;
  readonly variation?: string;
  readonly variationPercent?: string | null;
  readonly accounts: ReadonlyArray<ProfitLossAccountLine>;
}

export interface ProfitLossPreviousSummary {
  readonly fromDate: string;
  readonly toDate: string;
  readonly totalCharges: string;
  readonly totalProduits: string;
  readonly resultat: string;
}

export interface ProfitLossReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly charges: ReadonlyArray<ProfitLossLine>;
  readonly produits: ReadonlyArray<ProfitLossLine>;
  readonly totalCharges: string;
  readonly totalProduits: string;
  /** produits − charges. Positive = bénéfice, negative = perte. */
  readonly resultat: string;
  readonly previous?: ProfitLossPreviousSummary;
}
