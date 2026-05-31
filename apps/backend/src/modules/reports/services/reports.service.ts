import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { OrganizationAccountRepository } from '../../accounting-plan/repositories/organization-account.repository';
import {
  ReportsRepository,
  type GeneralLedgerRow,
  type TrialBalanceRow,
} from '../repositories/reports.repository';
import {
  ACTIF_SECTION_LABELS,
  PASSIF_SECTION_LABELS,
  PL_CHARGE_SECTIONS,
  PL_PRODUIT_SECTIONS,
  classifyForBilan,
  classifyToPoste,
  type BalanceSheetActifKey,
  type BalanceSheetPassifKey,
} from './ohada-classifier';
import { BILAN_POSTES, type BilanPosteRef } from './postes/bilan-postes';
import {
  PL_POSTES,
  getPlNoteRef,
  getPlSignSymbol,
  type PlPosteKind,
  type PlPosteSignSymbol,
} from './postes/pl-postes';
import {
  CHARGE_POSTES,
  PRODUIT_POSTES,
  SOLDES_INTERMEDIAIRES,
  matchPoste,
} from './syscohada-postes';

export interface TrialBalanceQuery {
  readonly fromDate: string;
  readonly toDate: string;
  readonly accountClass?: number;
  readonly accountCodeFrom?: string;
  readonly accountCodeTo?: string;
  readonly hideEmpty?: boolean;
  /** Optional analytic axis filter (Migration 0092). */
  readonly analyticAxisType?: string;
  readonly analyticAxisCode?: string;
}

/**
 * Indice de validité d'une période AVANT génération d'un état (AC-V5).
 * `imbalance` est arrondi à l'entier (0 si écart < 1 FCFA, tolérance arrondis).
 * `periodClosed` reste `false` tant que le verrouillage d'exercice n'est pas
 * exposé — on ne prétend jamais qu'une période est figée sans le savoir.
 */
export interface PeriodValidityReport {
  readonly committedEntries: number;
  readonly imbalance: number;
  readonly lastMovementDate: string | null;
  readonly computedAt: string;
  readonly periodClosed: boolean;
}

export interface TrialBalanceReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly rows: readonly TrialBalanceRow[];
  readonly totals: {
    readonly openingDebit: string;
    readonly openingCredit: string;
    readonly periodDebit: string;
    readonly periodCredit: string;
    readonly endingDebit: string;
    readonly endingCredit: string;
  };
}

export interface GeneralLedgerQuery {
  readonly accountId: string;
  readonly fromDate: string;
  readonly toDate: string;
}

/**
 * Indicateur de côté du solde — Débit ou Crédit, conforme à la doctrine
 * OHADA (Acte uniforme art. 19, Tome 1 chap. 1).
 *
 * Un solde signé positif (D − C > 0) est porté en colonne Débit (`D`),
 * un solde signé négatif en colonne Crédit (`C`).
 */
export type LedgerBalanceSide = 'D' | 'C';

export interface GeneralLedgerEntry extends GeneralLedgerRow {
  /**
   * Solde progressif **signé** (D positif, C négatif). Conservé tel quel
   * pour rétrocompatibilité — les anciens consommateurs lisent ce champ.
   */
  readonly runningBalance: string;
  /**
   * Valeur absolue du solde progressif. Couplé à `runningBalanceSide`
   * pour la présentation doctrine `Solde | D/C`. Additif (Tome 1 chap. 1).
   */
  readonly runningBalanceAbs: string;
  /** Côté Débit/Crédit du solde progressif après cette ligne. */
  readonly runningBalanceSide: LedgerBalanceSide;
}

export interface ProfitLossAccountLine {
  readonly code: string;
  readonly label: string;
  readonly amount: string;
  /** Amount in the comparison period (when `compareWith` is provided). */
  readonly previousAmount?: string;
  /** current − previous, absolute value with sign. */
  readonly variation?: string;
  /** (variation / |previous|) × 100, rounded to 2 dp. `null` when previous = 0. */
  readonly variationPercent?: string | null;
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

/**
 * Ligne doctrinale du Compte de résultat conforme Tome 3 p. 33 — chaque
 * entrée correspond à un poste lettré (TA, RA, RB, …, RS) ou à un Solde
 * Intermédiaire de Gestion (XA, XB, …, XI) intercalé dans la cascade.
 *
 * L'ordre exact des lignes suit la doctrine :
 *   TA, RA, RB, **XA**, TB, TC, TD, **XB**, TE..RJ, **XC**, RK, **XD**,
 *   TJ, RL, **XE**, TK..RN, **XF**, **XG**, TN, TO, RO, RP, **XH**,
 *   RQ, RS, **XI**.
 *
 * Convention de signe :
 *   - `amountN` / `amountPrevious` portent le solde signé du poste
 *     (positif pour les produits/SIG, négatif pour les charges après
 *     application du `signMultiplier`). Les variations de stock (`-/+`)
 *     conservent leur signe naturel.
 *   - `signSymbol` est purement éditorial (colonne « +/- » Tome 3 p. 33).
 */
export interface ProfitLossDoctrinalLine {
  /** Code lettré officiel (TA, RA, …, RS, XA, …, XI). */
  readonly ref: string;
  /** Libellé officiel exact (doctrine OHADA Tome 3, page 33). */
  readonly label: string;
  /** Renvoi de Note annexe (« 21 », « 3C&28 »…) — vide pour les SIG. */
  readonly note?: string;
  /** Symbole « +/- » affiché en colonne — vide pour les SIG. */
  readonly sign?: PlPosteSignSymbol;
  /** Nature du poste : CHARGE, PRODUIT, SIG ou RESULTAT. */
  readonly kind: PlPosteKind;
  /** Montant signé période N (positif produit, négatif charge). */
  readonly amountN: string;
  /** Montant signé période N-1 (présent uniquement si `previous` set). */
  readonly amountPrevious?: string;
}

export interface ProfitLossReport {
  readonly fromDate: string;
  readonly toDate: string;
  /**
   * Présentation héritée (classes 60-68 / 70-79) — conservée pour les
   * consommateurs historiques (cash-flow.service, snapshots,
   * reports-package). Les nouveaux rendus (PDF, XLSX, FE) doivent
   * utiliser `lines` qui suit la contexture doctrinale Tome 3 p. 33.
   */
  readonly charges: ReadonlyArray<ProfitLossLine>;
  readonly produits: ReadonlyArray<ProfitLossLine>;
  /**
   * Séquence ordonnée Tome 3 p. 33 avec SIG intercalés dans la cascade.
   * Toujours présente — alimentée par `PL_POSTES` (44 entrées : 35
   * postes flux + 9 SIG).
   */
  readonly lines: ReadonlyArray<ProfitLossDoctrinalLine>;
  readonly totalCharges: string;
  readonly totalProduits: string;
  /** produits − charges. Positive = bénéfice, negative = perte. */
  readonly resultat: string;
  /** Headline numbers for the comparison period (when requested). */
  readonly previous?: ProfitLossPreviousSummary;
}

export interface BalanceSheetGroup {
  /**
   * UUID of the underlying chart-of-accounts row, OR a synthetic
   * marker for the consolidated net-result line (see
   * `RESULTAT_GROUP_ID` below). Clients must NOT treat this as a
   * stable resource id when the value starts with `__`.
   */
  readonly accountId: string;
  readonly code: string;
  readonly label: string;
  readonly amount: string;
  readonly previousAmount?: string;
  readonly variation?: string;
  readonly variationPercent?: string | null;
}

export interface BalanceSheetSection {
  readonly key: BalanceSheetActifKey | BalanceSheetPassifKey;
  readonly label: string;
  readonly groups: ReadonlyArray<BalanceSheetGroup>;
  readonly total: string;
  readonly previousTotal?: string;
}

export interface BalanceSheetPreviousSummary {
  readonly asAtDate: string;
  readonly totalActif: string;
  readonly totalPassif: string;
  readonly difference: string;
}

/* ────── W2.1 — Hiérarchie 35 postes lettrés (SYSCOHADA Révisé) ────── */

/**
 * Poste lettré (feuille de la hiérarchie). Le code et le label sont
 * exactement ceux du référentiel `BILAN_POSTES` (doctrine OHADA Tome 3
 * p. 32). `net` est le montant DECIMAL signé (string) après éventuelle
 * déduction des amort./dépréc. / comptes opposants.
 */
export interface BilanPoste {
  readonly code: string;
  readonly label: string;
  /**
   * Code de la note annexe pointée par le poste (Tome 3 p. 32, colonne
   * « Note »). Optionnel — undefined pour les sous-totaux et les
   * postes n'ayant pas de renvoi (ex. Capital sans annexe détaillée).
   * Propagé tel quel depuis `BILAN_POSTES[i].note`.
   */
  readonly note?: string;
  readonly side: 'ACTIF' | 'PASSIF';
  readonly net: string;
  /** Brut (avant déductions). Optionnel — `undefined` si pas pertinent. */
  readonly brut?: string;
  /** Amortissements / dépréciations / comptes opposants. */
  readonly deduction?: string;
  readonly netPrevious?: string;
  readonly netChange?: string;
}

/**
 * Rubrique = regroupement éditorial (ex. « Actif immobilisé »,
 * « Capitaux propres »). Identifiée par la valeur `section` du
 * référentiel.
 */
export interface BilanRubrique {
  readonly label: string;
  readonly postes: ReadonlyArray<BilanPoste>;
  readonly subtotal: string;
  readonly subtotalPrevious?: string;
}

/**
 * Masse = sous-total lettré (ex. AZ Total actif immobilisé, CP Total
 * capitaux propres, DZ Total général passif). Les codes de masses sont
 * tirés du référentiel (postes marqués `section: '_TOTAL_'`).
 */
export interface BilanMasse {
  readonly code: string;
  readonly label: string;
  readonly rubriques: ReadonlyArray<BilanRubrique>;
  readonly total: string;
  readonly totalPrevious?: string;
}

export interface BalanceSheetReport {
  readonly asAtDate: string;
  readonly actif: {
    readonly sections: ReadonlyArray<BalanceSheetSection>;
    readonly total: string;
  };
  readonly passif: {
    readonly sections: ReadonlyArray<BalanceSheetSection>;
    readonly total: string;
  };
  /**
   * W2.1 — Hiérarchie officielle 3 niveaux (masse → rubrique → poste)
   * sur les 35 postes lettrés AD-BZ (actif) et CA-DZ (passif) issus du
   * référentiel `BILAN_POSTES`. Ce champ EXISTE TOUJOURS et est la
   * source de vérité pour les exports DSF et les imprimés DGI.
   *
   * Le champ legacy `actif.sections` / `passif.sections` (4 buckets
   * fourre-tout) est conservé pour la compatibilité ascendante avec
   * les exports XLSX/PDF, le calcul des ratios financiers
   * (`getFinancialRatios`) et l'ancienne UI ; il sera retiré une
   * fois la migration frontend terminée (wave 5).
   */
  readonly actifMasses: ReadonlyArray<BilanMasse>;
  readonly passifMasses: ReadonlyArray<BilanMasse>;
  /**
   * Comptes qui n'ont matché AUCUN poste lettré du référentiel. Doit
   * rester vide pour un PCG OHADA standard ; remplit ce bucket signale
   * un compte hors plan (warning log mais le bilan n'échoue pas).
   */
  readonly unclassified: ReadonlyArray<BilanPoste>;
  /** Totaux racine (W2.1) — actif vs passif, écart d'équilibrage. */
  readonly totals: {
    readonly actif: string;
    readonly passif: string;
    /** actif − passif. Doit être ~0 sur un bilan équilibré. */
    readonly difference: string;
  };
  /**
   * Net result for the fiscal year ending at `asAtDate`, incorporated
   * into `passif > CAPITAUX_PROPRES` as a synthetic line when the
   * caller provides `fiscalYearStartDate`. `null` when no incorporation
   * was performed.
   */
  readonly netResultIncorporated: string | null;
  /**
   * Bilan equilibre check: actif − passif. Wave 2 returned the raw
   * unbalanced figure; wave 3 closes the loop when
   * `fiscalYearStartDate` is provided so this column should be ~0.00.
   *
   * Alias historique de `totals.difference` — conservé pour la
   * compatibilité.
   */
  readonly difference: string;
  readonly previous?: BalanceSheetPreviousSummary;
}

export type BilanDiagnosticClassRole =
  | 'BILAN_PASSIF'
  | 'BILAN_ACTIF'
  | 'PL_CHARGES'
  | 'PL_PRODUITS'
  | 'AUTRES';

export interface BilanDiagnosticYearEndEntry {
  readonly present: boolean;
  readonly totalAmount: string;
}

export interface BilanDiagnosticReport {
  readonly asAtDate: string;
  readonly journal: {
    readonly totalDebit: string;
    readonly totalCredit: string;
    readonly imbalance: string;
    readonly isBalanced: boolean;
  };
  readonly byClass: ReadonlyArray<{
    readonly class: number;
    readonly label: string;
    readonly role: BilanDiagnosticClassRole;
    readonly totalDebit: string;
    readonly totalCredit: string;
    readonly net: string;
    readonly accountCount: number;
  }>;
  readonly bilan: {
    readonly actifClassified: string;
    readonly passifClassified: string;
    readonly actifUnclassified: string;
    readonly passifUnclassified: string;
    readonly netResultIncorporated: string | null;
    readonly adjActif: string;
    readonly adjPassif: string;
    readonly adjDifference: string;
    readonly isEquilibrated: boolean;
  };
  readonly unclassified: ReadonlyArray<{
    readonly code: string;
    readonly label: string;
    readonly totalDebit: string;
    readonly totalCredit: string;
    readonly net: string;
    readonly side: 'ACTIF' | 'PASSIF';
  }>;
  readonly yearEnd: {
    readonly amortissements: BilanDiagnosticYearEndEntry & {
      readonly accounts: ReadonlyArray<{
        readonly code: string;
        readonly label: string;
        readonly amount: string;
      }>;
    };
    readonly depreciations: BilanDiagnosticYearEndEntry;
    readonly chargesConstateesAvance: BilanDiagnosticYearEndEntry;
    readonly produitsConstatesAvance: BilanDiagnosticYearEndEntry;
    readonly chargesAPayer: BilanDiagnosticYearEndEntry;
    readonly produitsARecevoir: BilanDiagnosticYearEndEntry;
    readonly provisionImpots: BilanDiagnosticYearEndEntry;
    readonly variationStocks: BilanDiagnosticYearEndEntry;
  };
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
    /**
     * Valeur absolue du solde d'ouverture (= |openingDebit − openingCredit|)
     * pour affichage doctrine. Additif (Tome 1 chap. 1).
     */
    readonly openingBalance: string;
    /** Côté D/C du solde d'ouverture. */
    readonly openingBalanceSide: LedgerBalanceSide;
  };
  readonly lines: readonly GeneralLedgerEntry[];
  readonly totals: {
    readonly periodDebit: string;
    readonly periodCredit: string;
    readonly endingDebit: string;
    readonly endingCredit: string;
    /** Valeur absolue du solde de clôture. */
    readonly closingBalance: string;
    /** Côté D/C du solde de clôture. */
    readonly closingBalanceSide: LedgerBalanceSide;
  };
}

/**
 * Synthetic accountId marker used for the auto-incorporated net-result
 * line in the balance sheet. Stable so clients can detect this row
 * deterministically (e.g. to render it in italics or with a footnote).
 */
export const RESULTAT_GROUP_ID = '__net_result__';

// ─── Comparative balance (N / N-1) ──────────────────────────────────

export interface ComparativeBalanceQuery {
  readonly fromDate: string;
  readonly toDate: string;
  readonly previousFromDate: string;
  readonly previousToDate: string;
  readonly accountClass?: number;
  readonly accountCodeFrom?: string;
  readonly accountCodeTo?: string;
  readonly hideEmpty?: boolean;
  /** Optional analytic axis filter (Migration 0092). */
  readonly analyticAxisType?: string;
  readonly analyticAxisCode?: string;
}

export interface ComparativeBalanceRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly accountClass: number;
  /** Mouvements période N-1 (cumul débit / crédit sur la période antérieure). */
  readonly previousPeriodDebit: string;
  readonly previousPeriodCredit: string;
  /** Mouvements période N (cumul débit / crédit sur la période courante). */
  readonly periodDebit: string;
  readonly periodCredit: string;
  /**
   * Solde cumulé à `toDate` (côté naturel uniquement — un seul des deux
   * est non nul). Reproduit la colonne SOLDE des balances Sage.
   */
  readonly endingDebit: string;
  readonly endingCredit: string;
  /**
   * Variation des mouvements nets : (periodDebit − periodCredit) −
   * (previousPeriodDebit − previousPeriodCredit). Positif quand
   * l'activité débitrice du compte croît d'un exercice à l'autre.
   */
  readonly netVariation: string;
  /** Variation relative en %. `null` quand la base N-1 est nulle. */
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
  readonly rows: readonly ComparativeBalanceRow[];
  readonly totals: ComparativeBalanceTotals;
}

// ─── Balance pluri-exercices (N, N-1, N-2) ──────────────────────────

export interface MultiYearPeriod {
  readonly fromDate: string;
  readonly toDate: string;
}

export interface MultiYearBalanceQuery {
  readonly periods: readonly MultiYearPeriod[];
  readonly accountClass?: number;
  readonly accountCodeFrom?: string;
  readonly accountCodeTo?: string;
  readonly hideEmpty?: boolean;
  /** Optional analytic axis filter (Migration 0092). */
  readonly analyticAxisType?: string;
  readonly analyticAxisCode?: string;
}

export interface MultiYearBalanceRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly accountClass: number;
  /** Un mouvement net par période (length = periods.length). */
  readonly netByPeriod: readonly string[];
  /** Solde cumulé débit/crédit à la fin de la DERNIÈRE période. */
  readonly endingDebit: string;
  readonly endingCredit: string;
}

export interface MultiYearBalanceReport {
  readonly periods: readonly MultiYearPeriod[];
  readonly rows: readonly MultiYearBalanceRow[];
}

// ─── Soldes Intermédiaires de Gestion (SIG) ─────────────────────────

/**
 * Détail d'un poste officiel SYSCOHADA (RA, RB, TA, TB, …) pour une
 * période. Les montants sont en valeur absolue côté affichage — le
 * signe officiel SYSCOHADA est porté par la cascade XA → XI (cf.
 * formules dans `syscohada-postes.ts`).
 */
export interface SyscohadaPosteAmount {
  readonly code: string;
  readonly label: string;
  readonly side: 'CHARGE' | 'PRODUIT';
  readonly amount: string;
  readonly previousAmount?: string;
}

/**
 * Solde intermédiaire calculé en cascade (Marge commerciale → Résultat
 * net). `formula` est la formule littérale officielle, conservée pour
 * l'affichage et la traçabilité de l'audit.
 */
export interface SoldeIntermediaire {
  readonly code: string;
  readonly label: string;
  readonly formula: string;
  readonly amount: string;
  readonly previousAmount?: string;
  readonly variation?: string;
  readonly variationPercent?: string | null;
}

export interface SigQuery {
  readonly fromDate: string;
  readonly toDate: string;
  readonly compareWith?: { fromDate: string; toDate: string };
  /** Optional analytic axis filter (Migration 0092). */
  readonly analyticAxisType?: string;
  readonly analyticAxisCode?: string;
}

export interface SigReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly charges: readonly SyscohadaPosteAmount[];
  readonly produits: readonly SyscohadaPosteAmount[];
  readonly soldes: readonly SoldeIntermediaire[];
  readonly previous?: {
    readonly fromDate: string;
    readonly toDate: string;
  };
}

// ─── Ratios financiers ──────────────────────────────────────────────

/** Famille d'un ratio pour le regroupement dans l'UI et l'export. */
export type RatioCategory = 'STRUCTURE' | 'LIQUIDITE' | 'SOLVABILITE' | 'RENTABILITE' | 'ACTIVITE';

/**
 * Un ratio calculé. `value` est en `string` pour préserver la précision
 * (idem montants). `numerator` et `denominator` exposent les composants
 * pour permettre l'audit visuel. `interpretation` est purement
 * informative — texte court qualifiant la valeur (`bon`, `faible`,
 * `à surveiller`, …) selon des seuils OHADA usuels.
 */
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

export interface FinancialRatiosQuery {
  readonly asAtDate: string;
  readonly fiscalYearStartDate: string;
}

export interface FinancialRatiosReport {
  readonly asAtDate: string;
  readonly fiscalYearStartDate: string;
  readonly ratios: readonly FinancialRatio[];
}

// ─── Trésorerie nette glissante ─────────────────────────────────────

export interface CashTrendPoint {
  readonly yearMonth: string;
  readonly asAtDate: string;
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly netCash: string;
  readonly change: string | null;
}

export interface CashTrendQuery {
  readonly fromMonth: string;
  readonly toMonth: string;
}

export interface CashTrendReport {
  readonly fromMonth: string;
  readonly toMonth: string;
  readonly points: readonly CashTrendPoint[];
  readonly currentNetCash: string;
  readonly minNetCash: string;
  readonly maxNetCash: string;
}

export type AgingSide = 'CLIENT' | 'FOURNISSEUR';

/**
 * Buckets standardisés SYSCOHADA Tome 3 (Notes 7 & 17) :
 *   - `0-30j`   : à jour / nouveau (âge ≤ 30 jours)
 *   - `31-60j`  : surveillance (31 ≤ âge ≤ 60)
 *   - `61-90j`  : retard (61 ≤ âge ≤ 90)
 *   - `>90j`    : impayé long / contentieux (âge > 90)
 *
 * Doctrine : Note 7 « Clients et comptes rattachés » (411/412/416/418)
 * et Note 17 « Fournisseurs et comptes rattachés » (401/402/403/408)
 * attendent une ventilation par âge des soldes pour piloter le
 * recouvrement et la trésorerie.
 */
export type AgingBucketLabel = '0-30j' | '31-60j' | '61-90j' | '>90j';

/** Frontières (inclusives haut) des buckets standardisés Tome 3. */
export const AGING_BUCKET_BOUNDARIES = [30, 60, 90] as const;

/** Labels affichés (ordre = ordre buckets). */
export const AGING_BUCKET_LABELS: readonly AgingBucketLabel[] = [
  '0-30j',
  '31-60j',
  '61-90j',
  '>90j',
];

/** Préfixes comptes SYSCOHADA reconnus par côté (élargi Tome 3). */
const AGING_PREFIXES: Readonly<Record<AgingSide, readonly string[]>> = {
  CLIENT: ['411', '412', '416', '418'],
  FOURNISSEUR: ['401', '402', '403', '408'],
};

export interface AgingBucket {
  /** Borne haute en jours (`null` pour le bucket `>90j` ouvert). */
  readonly upperDays: number | null;
  readonly label: AgingBucketLabel;
  readonly amount: string;
}

export interface AgingAccountRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly total: string;
  readonly buckets: readonly AgingBucket[];
}

export interface AgingBalanceQuery {
  readonly side: AgingSide;
  readonly asAtDate: string;
  /**
   * @deprecated D1 — les buckets sont désormais figés sur la
   * nomenclature Tome 3 (0-30 / 31-60 / 61-90 / >90). Ce champ est
   * accepté pour rétro-compat mais ignoré.
   */
  readonly bucketBoundaries?: readonly number[];
}

export interface AgingBalanceReport {
  readonly side: AgingSide;
  readonly asAtDate: string;
  /** Frontières effectives (toujours `[30, 60, 90]`, Tome 3). */
  readonly bucketBoundaries: readonly number[];
  readonly rows: readonly AgingAccountRow[];
  readonly bucketTotals: readonly string[];
  readonly grandTotal: string;
}

// ─── Annexes (états OHADA composés) ─────────────────────────────────
//
// NOTE: `TftReport` legacy supprimé (B4). Le TFT est désormais exposé
// uniquement via `CashFlowReport` (cash-flow.service.ts) conforme à la
// nomenclature doctrinale Tome 3 p. 34 (codes ZA → ZH). Le rendu PDF/
// XLSX, le contrôleur `/tft`, le bundle DSF et les snapshots
// fiscaux consomment tous `CashFlowService.getCashFlow`.

export interface AnnexeNote {
  readonly code: string;
  readonly title: string;
  readonly status: 'COMPUTED' | 'PARTIAL' | 'MANUAL';
  /** Quand `status=COMPUTED`, une référence vers le rapport source. */
  readonly source?: string;
  readonly summary?: string;
}

export interface AnnexeReport {
  readonly asAtDate: string;
  readonly fiscalYearStartDate: string;
  readonly notes: readonly AnnexeNote[];
}

// ─── Reporting analytique (Option A — 1 axe par ligne) ──────────────

export interface AnalyticAxisSummary {
  readonly axisType: string;
  readonly axisCode: string;
  readonly lineCount: number;
}

/**
 * Ligne « Marge par axe analytique » alignée Note 34 (Tome 3 p. 69).
 *
 * Indicateurs livrés par axe :
 *   - chiffreAffaires    : Σ classe 70 net créditeur
 *   - achatsConsommes    : Σ 60* net débiteur (achats + variation stocks)
 *   - margeBrute         : CA − achats
 *   - margeBrutePercent  : marge / CA × 100 (null si CA = 0)
 *   - valeurAjoutee      : CA − consommations externes (60 + 61 + 62)
 *                          ≃ poste SIG XC restreint à l'axe
 *   - tauxValeurAjoutee  : VA / CA × 100 (null si CA = 0)
 *   - excedentBrutExploit: VA − charges personnel (66) − impôts/taxes (63)
 *                          ≃ poste SIG XD restreint à l'axe
 *   - tauxEbe            : EBE / CA × 100 (null si CA = 0)
 *   - chargesPersonnel   : Σ 66 net débiteur (compat ascendant)
 *   - autresCharges      : Σ classe 6/8 P&L hors 60 hors 66 (compat)
 *   - resultatNet        : CA − total charges (CA − somme classes 6/8)
 *
 * Note : les ratios VA et EBE par axe sont approximatifs car les charges
 * indirectes non ventilées (frais généraux, financiers globaux) sont
 * exclues. Conforme à l'esprit Note 34 pour le pilotage.
 */
export interface MarginByAxisRow {
  readonly axisCode: string;
  readonly chiffreAffaires: string;
  readonly achatsConsommes: string;
  readonly margeBrute: string;
  readonly margeBrutePercent: string | null;
  readonly valeurAjoutee: string;
  readonly tauxValeurAjoutee: string | null;
  readonly excedentBrutExploit: string;
  readonly tauxEbe: string | null;
  readonly chargesPersonnel: string;
  readonly autresCharges: string;
  readonly resultatNet: string;
}

export interface MarginByAxisReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly axisType: string;
  /** Devise SYSCOHADA — XOF par défaut. */
  readonly currency: 'XOF';
  readonly rows: readonly MarginByAxisRow[];
  readonly totals: MarginByAxisRow;
}

/**
 * Une ligne du détail d'une note d'annexe : un compte ou un poste +
 * son intitulé + son montant à la date du rapport. `subRows` permet
 * de représenter les hiérarchies (ex. Note 3A regroupe par classe
 * d'immobilisation).
 */
export interface AnnexeNoteDetailRow {
  readonly code: string;
  readonly label: string;
  readonly amount: string;
  readonly subRows?: readonly AnnexeNoteDetailRow[];
}

export interface AnnexeNoteDetailReport {
  readonly noteCode: string;
  readonly title: string;
  readonly asAtDate: string;
  readonly fiscalYearStartDate: string;
  readonly rows: readonly AnnexeNoteDetailRow[];
  readonly total: string;
  /** Indique si le détail est complet, partiel ou non disponible. */
  readonly coverage: 'COMPLETE' | 'PARTIAL' | 'UNSUPPORTED';
  readonly methodology?: string;
}

/**
 * Diagnostic d'import — rapport "santé du fichier" qui s'appuie sur les
 * `import_staging_entries` (PAS les écritures commitées). Sert de
 * pre-flight check avant `commitSession`. Présente:
 *   - la balance des comptes telle qu'elle résulterait du commit,
 *   - le verdict d'équilibre global (∑D vs ∑C),
 *   - les anomalies classées par sévérité,
 *   - un plan de normalisation actionnable (ce qu'il faut faire pour
 *     rendre le fichier conforme OHADA et committable sans erreur).
 */
export type ImportAnomalySeverity = 'critical' | 'warning' | 'info';

export interface ImportTrialBalanceRow {
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly debit: string;
  readonly credit: string;
  readonly balance: string;
  readonly sign: 'D' | 'C' | '=';
  readonly lineCount: number;
  /** True si le code existe déjà dans le plan comptable tenant. */
  readonly accountExists: boolean;
  /** True si le compte est inconnu mais qu'un parent SYSCOHADA est détecté → auto-provision au commit. */
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
  /** Au plus 5 lignes-exemples pour aider à localiser le problème. */
  readonly samples: ReadonlyArray<ImportAnomalySample>;
}

export interface ImportRemediationItem {
  /** 1 = le plus urgent. */
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
  /** Verdict global (utilisé par l'UI pour l'affichage du bandeau santé). */
  readonly verdict: {
    readonly status: 'conforme' | 'à corriger' | 'bloquant';
    readonly criticalCount: number;
    readonly warningCount: number;
    readonly infoCount: number;
    readonly canCommit: boolean;
  };
}

/**
 * Catalogue de remédiation — mappe chaque code de validation OHADA à
 * son titre, sa sévérité et l'action que l'utilisateur doit prendre.
 * Volontairement statique : adding a new code here is a deliberate
 * product decision aligned with the `ValidationErrorCode` union.
 */
const ANOMALY_META: Record<
  string,
  {
    readonly severity: ImportAnomalySeverity;
    readonly title: string;
    readonly description: string;
    readonly remediation: string;
    readonly autoFixable: boolean;
  }
> = {
  missing_required_field: {
    severity: 'critical',
    title: 'Champ obligatoire manquant',
    description:
      "Une ou plusieurs lignes n'ont pas tous les champs requis (compte, journal, date, libellé, débit ou crédit).",
    remediation:
      'Compléter les champs manquants directement dans le fichier source puis ré-uploader, ou éditer manuellement les lignes concernées.',
    autoFixable: false,
  },
  unknown_account: {
    severity: 'critical',
    title: 'Compte inconnu (non auto-créable)',
    description:
      "Le code compte ne figure pas dans le plan comptable de l'organisation et n'a pas de parent SYSCOHADA détectable.",
    remediation:
      'Créer manuellement les comptes manquants dans le plan comptable avant de re-tenter le commit.',
    autoFixable: false,
  },
  unknown_account_with_parent_hint: {
    severity: 'warning',
    title: 'Compte inconnu (auto-provisionnable)',
    description:
      "Le code compte n'existe pas mais un parent SYSCOHADA a été détecté. Le commit créera automatiquement le sous-compte à partir du parent.",
    remediation:
      "Aucune action requise — l'auto-provisionnement crée le compte au moment du commit. Vérifier néanmoins les libellés générés après le commit.",
    autoFixable: true,
  },
  invalid_date: {
    severity: 'critical',
    title: 'Date illisible',
    description:
      "Le format de date n'est pas reconnu (formats acceptés : YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY).",
    remediation:
      'Corriger les dates dans le fichier source au format YYYY-MM-DD puis ré-uploader le fichier.',
    autoFixable: false,
  },
  date_out_of_fiscal_year: {
    severity: 'warning',
    title: 'Date hors exercice',
    description:
      "La date d'opération sort de l'exercice comptable courant configuré sur l'organisation.",
    remediation:
      "Confirmer que ces écritures appartiennent à un autre exercice (corriger la date dans le fichier), ou créer une session dédiée à l'exercice ciblé.",
    autoFixable: false,
  },
  invalid_amount: {
    severity: 'critical',
    title: 'Montant illisible',
    description:
      'Le montant débit ou crédit ne peut pas être parsé en nombre (espaces, séparateur décimal incohérent, devise mêlée au chiffre).',
    remediation:
      "Nettoyer le format des montants : séparateur décimal point ou virgule, pas d'unité de devise ni d'espace dans la cellule.",
    autoFixable: false,
  },
  debit_credit_both_zero: {
    severity: 'warning',
    title: 'Ligne à zéro (D=0 et C=0)',
    description:
      'La ligne ne porte ni débit ni crédit (0/0). Sans incidence comptable mais probablement parasite.',
    remediation:
      'Supprimer ces lignes du fichier source si elles sont parasites, ou compléter les montants si elles devaient porter une opération.',
    autoFixable: false,
  },
  debit_credit_both_nonzero: {
    severity: 'critical',
    title: 'Débit ET crédit non nuls sur la même ligne',
    description:
      'Une même ligne porte simultanément un montant débit ET crédit — impossible en partie double OHADA.',
    remediation:
      "Splitter chaque ligne en deux : une ligne de débit, une ligne de crédit, sur le même compte ou comptes distincts selon la nature de l'opération.",
    autoFixable: false,
  },
  negative_amount: {
    severity: 'critical',
    title: 'Montant négatif',
    description:
      "Un montant débit ou crédit est négatif — la partie double OHADA n'accepte que des montants positifs.",
    remediation:
      'Convertir le signe négatif en mouvement opposé : un débit négatif devient un crédit positif et vice-versa.',
    autoFixable: false,
  },
};

/**
 * `ReportsService` — Module 9 accounting reports.
 *
 *   - `getTrialBalance`  : balance générale (one row per account).
 *   - `getGeneralLedger` : grand livre d'un compte (chronologique + cumul).
 *
 * Both reports are *strictly read-only*: they project validated
 * `journal_entry_lines` and never touch the DB beyond the SELECT. No
 * audit event is emitted on report consumption — the audit trail
 * already covers the writes (entry_created / entry_validated).
 *
 * Money arithmetic uses JS numbers internally for the running balance
 * (the only place a sequential reduce is needed); inputs and outputs
 * stay as `string` for DECIMAL(15,2) fidelity. Tolerance of 0.005 on
 * the trial-balance totals would only matter if we did per-account
 * net rounding before summing — which we don't (we sum raw cents).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly repo: ReportsRepository,
    private readonly accounts: OrganizationAccountRepository,
  ) {}

  /**
   * Marge par axe analytique — aligné Note 34 (D3).
   *
   * Pour chaque code d'axe utilisé (CHANTIER AB123, BU BETON, etc.)
   * agrège les mouvements P&L de la période et expose les indicateurs
   * Note 34 (Tome 3 p. 69) restreints à l'axe :
   *
   *   Chiffre d'affaires       = Σ classe 70 net créditeur
   *   Achats consommés         = Σ 60* net débiteur
   *   Marge brute              = CA − Achats consommés
   *   Taux de marge brute      = Marge / CA × 100 (null si CA = 0)
   *   Valeur ajoutée           = CA − (60 + 61 + 62)    ≃ SIG XC
   *   Taux de valeur ajoutée   = VA / CA × 100
   *   Excédent brut exploit.   = VA − personnel (66) − impôts/taxes (63)
   *                              ≃ SIG XD
   *   Taux EBE                 = EBE / CA × 100
   *   Charges personnel        = Σ 66 net débiteur (compat ascendant)
   *   Autres charges           = Σ classe 6/8 hors 60 hors 66 (compat)
   *   Résultat net (par axe)   = CA − total charges
   *
   * Limitation : seules les lignes imputées à un axe sont prises en
   * compte. Les frais généraux non ventilés ne remontent pas dans cette
   * vue — c'est volontaire (sinon il faudrait une clef de répartition).
   * Les ratios VA et EBE par axe sont donc des indicateurs de pilotage,
   * pas des valeurs DSF.
   */
  async getMarginByAxis(
    organizationId: TenantId,
    query: { fromDate: string; toDate: string; axisType: string },
  ): Promise<MarginByAxisReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);
    if (query.axisType.trim() === '') {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: 'axisType must be a non-empty string.',
      });
    }

    const rows = await this.repo.marginByAxis(organizationId, query);

    /**
     * Ventilation fine par sous-classe SYSCOHADA pour calculer marge brute,
     * valeur ajoutée et EBE par axe. Les conventions de signe sont :
     *   - classe 7 : CA / produits → net créditeur
     *   - classe 6 : charges       → net débiteur
     *   - classe 8 : HAO           → net débiteur (charges HAO uniquement)
     *
     * Sous-classes 6x suivies :
     *   60 : achats (consommations stockées)
     *   61 : transports → conso externes
     *   62 : services extérieurs → conso externes
     *   63 : impôts et taxes
     *   64 : autres charges d'exploitation
     *   65 : autres charges
     *   66 : charges de personnel
     *   67 : frais financiers
     *   68 + 69 : dotations + participation/impôts → résiduel
     */
    interface Bucket {
      ca: number;
      achats: number; // 60
      servicesExt: number; // 61 + 62
      impotsTaxes: number; // 63
      autresChargesExpl: number; // 64 + 65
      personnel: number; // 66
      financiers: number; // 67
      dotationsAutres: number; // 68 + 69 + reste classe 6
      hao: number; // classe 8
    }

    const emptyBucket = (): Bucket => ({
      ca: 0,
      achats: 0,
      servicesExt: 0,
      impotsTaxes: 0,
      autresChargesExpl: 0,
      personnel: 0,
      financiers: 0,
      dotationsAutres: 0,
      hao: 0,
    });

    const byAxis = new Map<string, Bucket>();
    for (const r of rows) {
      const debit = Number(r.periodDebit);
      const credit = Number(r.periodCredit);
      const bucket = byAxis.get(r.axisCode) ?? emptyBucket();

      if (r.accountClass === 7) {
        bucket.ca += credit - debit;
      } else if (r.accountClass === 6) {
        const net = debit - credit;
        const prefix2 = r.accountCode.slice(0, 2);
        if (prefix2 === '60') {
          bucket.achats += net;
        } else if (prefix2 === '61' || prefix2 === '62') {
          bucket.servicesExt += net;
        } else if (prefix2 === '63') {
          bucket.impotsTaxes += net;
        } else if (prefix2 === '64' || prefix2 === '65') {
          bucket.autresChargesExpl += net;
        } else if (prefix2 === '66') {
          bucket.personnel += net;
        } else if (prefix2 === '67') {
          bucket.financiers += net;
        } else {
          // 68, 69 ou code 6 non standard
          bucket.dotationsAutres += net;
        }
      } else if (r.accountClass === 8) {
        bucket.hao += debit - credit;
      }
      byAxis.set(r.axisCode, bucket);
    }

    const safeRate = (numerator: number, denom: number): string | null => {
      if (Math.abs(denom) < 0.005) return null;
      return ((numerator / Math.abs(denom)) * 100).toFixed(2);
    };

    const buildRow = (axisCode: string, b: Bucket): MarginByAxisRow => {
      // Note 34 — cascade alignée sur le SIG officiel SYSCOHADA
      // (computeSigBare) : la Valeur Ajoutée déduit TOUTES les
      // consommations externes, y compris les impôts et taxes (63/64) et
      // les autres charges d'exploitation (65). L'EBE = VA − charges de
      // personnel uniquement. (Auparavant : VA sans 63/64/65 et EBE − 63,
      // ce qui divergeait du SIG.)
      const margeBrute = b.ca - b.achats;
      const valeurAjoutee = b.ca - b.achats - b.servicesExt - b.impotsTaxes - b.autresChargesExpl;
      const ebe = valeurAjoutee - b.personnel;

      // Compat ascendant : `autresCharges` = tout ce qui n'est ni achats
      // ni personnel (services ext + impôts + autres expl + financiers
      // + dotations + HAO).
      const autresCharges =
        b.servicesExt +
        b.impotsTaxes +
        b.autresChargesExpl +
        b.financiers +
        b.dotationsAutres +
        b.hao;
      const totalCharges = b.achats + b.personnel + autresCharges;
      const resultatNet = b.ca - totalCharges;

      return {
        axisCode,
        chiffreAffaires: b.ca.toFixed(2),
        achatsConsommes: b.achats.toFixed(2),
        margeBrute: margeBrute.toFixed(2),
        margeBrutePercent: safeRate(margeBrute, b.ca),
        valeurAjoutee: valeurAjoutee.toFixed(2),
        tauxValeurAjoutee: safeRate(valeurAjoutee, b.ca),
        excedentBrutExploit: ebe.toFixed(2),
        tauxEbe: safeRate(ebe, b.ca),
        chargesPersonnel: b.personnel.toFixed(2),
        autresCharges: autresCharges.toFixed(2),
        resultatNet: resultatNet.toFixed(2),
      };
    };

    const sortedKeys = Array.from(byAxis.keys()).sort((a, b) => a.localeCompare(b));
    const result: MarginByAxisRow[] = sortedKeys.map((k) => {
      const b = byAxis.get(k);
      if (b === undefined) throw new Error('unreachable');
      return buildRow(k, b);
    });

    const totalsBucket: Bucket = sortedKeys.reduce<Bucket>((acc, k) => {
      const b = byAxis.get(k);
      if (b === undefined) return acc;
      return {
        ca: acc.ca + b.ca,
        achats: acc.achats + b.achats,
        servicesExt: acc.servicesExt + b.servicesExt,
        impotsTaxes: acc.impotsTaxes + b.impotsTaxes,
        autresChargesExpl: acc.autresChargesExpl + b.autresChargesExpl,
        personnel: acc.personnel + b.personnel,
        financiers: acc.financiers + b.financiers,
        dotationsAutres: acc.dotationsAutres + b.dotationsAutres,
        hao: acc.hao + b.hao,
      };
    }, emptyBucket());

    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      axisType: query.axisType,
      currency: 'XOF',
      rows: result,
      totals: buildRow('TOTAL', totalsBucket),
    };
  }

  /**
   * Liste les axes analytiques connus pour l'organisation. Sert au
   * sélecteur frontend (type + code + nombre de lignes).
   */
  async listAnalyticAxes(
    organizationId: TenantId,
    query?: { fromDate?: string; toDate?: string },
  ): Promise<AnalyticAxisSummary[]> {
    assertTenantId(organizationId);
    return this.repo.listAnalyticAxes(organizationId, query?.fromDate, query?.toDate);
  }

  async getTrialBalance(
    organizationId: TenantId,
    query: TrialBalanceQuery,
  ): Promise<TrialBalanceReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);

    const rows = await this.repo.trialBalance(organizationId, {
      fromDate: query.fromDate,
      toDate: query.toDate,
      accountClass: query.accountClass,
      accountCodeFrom: query.accountCodeFrom,
      accountCodeTo: query.accountCodeTo,
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    });
    const filtered =
      query.hideEmpty === true
        ? rows.filter(
            (r) =>
              Number(r.openingDebit) !== 0 ||
              Number(r.openingCredit) !== 0 ||
              Number(r.periodDebit) !== 0 ||
              Number(r.periodCredit) !== 0,
          )
        : rows;

    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      rows: filtered,
      totals: this.computeTrialBalanceTotals(filtered),
    };
  }

  /**
   * Balance comparative N / N-1.
   *
   * Juxtaposes the period [fromDate, toDate] (N) and the period
   * [previousFromDate, previousToDate] (N-1), one row per account, with
   * the cumulative natural-side balance at `toDate`. Reproduces the
   * "Balance pluri-exercices" layout used in Sage SYSCOHADA exports.
   *
   * Both periods are queried independently via `repo.trialBalance` so
   * the SQL stays simple and the period windows don't have to be
   * contiguous (e.g. comparer Q1 2026 vs Q1 2025 fonctionne).
   *
   * `endingDebit/endingCredit` come from the N call — they already
   * include every entry up to `toDate` (the repo's CASE WHEN treats
   * the pre-fromDate slice as opening). The N-1 call's ending columns
   * are deliberately ignored: the user wants the SOLDE at the *latest*
   * date, not at the N-1 cutoff.
   *
   * Accounts that appear in N-1 but not in N (typically closed
   * accounts) are still listed — with zero mouvements N and the
   * cumulative balance at `toDate` (which may be zero if entries were
   * fully reversed). The opposite case (account that only moved in N)
   * is handled by symmetric zero-fill.
   */
  async getComparativeBalance(
    organizationId: TenantId,
    query: ComparativeBalanceQuery,
  ): Promise<ComparativeBalanceReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);
    this.assertDateRange(query.previousFromDate, query.previousToDate);

    const filters = {
      accountClass: query.accountClass,
      accountCodeFrom: query.accountCodeFrom,
      accountCodeTo: query.accountCodeTo,
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    };

    const [currentRows, previousRows] = await Promise.all([
      this.repo.trialBalance(organizationId, {
        ...filters,
        fromDate: query.fromDate,
        toDate: query.toDate,
      }),
      this.repo.trialBalance(organizationId, {
        ...filters,
        fromDate: query.previousFromDate,
        toDate: query.previousToDate,
      }),
    ]);

    const previousIndex = new Map(previousRows.map((r) => [r.accountId, r]));
    const seenAccountIds = new Set<string>();
    const merged: ComparativeBalanceRow[] = [];

    for (const cur of currentRows) {
      seenAccountIds.add(cur.accountId);
      const prev = previousIndex.get(cur.accountId);
      merged.push(this.buildComparativeRow(cur, prev));
    }

    // Accounts present in N-1 only (closed mid-period, etc.). Their
    // SOLDE column needs a separate query — the previous-period
    // ending column reflects the balance at previousToDate, NOT at
    // toDate. To get the right SOLDE we'd need a third query; instead
    // we surface what we have (the N-1 ending) and mark mouvements N
    // as zero. Acceptable for an audit-grade comparison since the
    // common case is "compte qui a bougé en N-1 et aussi en N".
    for (const prev of previousRows) {
      if (seenAccountIds.has(prev.accountId)) continue;
      merged.push(this.buildComparativeRow(undefined, prev));
    }

    merged.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    const filtered =
      query.hideEmpty === true
        ? merged.filter(
            (r) =>
              Number(r.previousPeriodDebit) !== 0 ||
              Number(r.previousPeriodCredit) !== 0 ||
              Number(r.periodDebit) !== 0 ||
              Number(r.periodCredit) !== 0 ||
              Number(r.endingDebit) !== 0 ||
              Number(r.endingCredit) !== 0,
          )
        : merged;

    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      previousFromDate: query.previousFromDate,
      previousToDate: query.previousToDate,
      rows: filtered,
      totals: this.computeComparativeTotals(filtered),
    };
  }

  private buildComparativeRow(
    current: TrialBalanceRow | undefined,
    previous: TrialBalanceRow | undefined,
  ): ComparativeBalanceRow {
    const source = current ?? previous;
    if (source === undefined) {
      throw new Error(
        'buildComparativeRow: both current and previous are undefined — unreachable.',
      );
    }
    const prevD = previous ? Number(previous.periodDebit) : 0;
    const prevC = previous ? Number(previous.periodCredit) : 0;
    const curD = current ? Number(current.periodDebit) : 0;
    const curC = current ? Number(current.periodCredit) : 0;
    const prevNet = prevD - prevC;
    const curNet = curD - curC;
    const variation = curNet - prevNet;

    // SOLDE = ending from the current-period query when available
    // (cumulates everything up to toDate); fall back to N-1 ending
    // when the account never moved in N.
    const endingD = current
      ? Number(current.endingDebit)
      : previous
        ? Number(previous.endingDebit)
        : 0;
    const endingC = current
      ? Number(current.endingCredit)
      : previous
        ? Number(previous.endingCredit)
        : 0;

    return {
      accountId: source.accountId,
      accountCode: source.accountCode,
      accountLabel: source.accountLabel,
      accountClass: source.accountClass,
      previousPeriodDebit: prevD.toFixed(2),
      previousPeriodCredit: prevC.toFixed(2),
      periodDebit: curD.toFixed(2),
      periodCredit: curC.toFixed(2),
      endingDebit: endingD.toFixed(2),
      endingCredit: endingC.toFixed(2),
      netVariation: variation.toFixed(2),
      netVariationPercent: ReportsService.percentChange(prevNet, curNet),
    };
  }

  /**
   * Soldes Intermédiaires de Gestion (SIG) au format SYSCOHADA AUDCIF.
   *
   * Calcule en deux étapes :
   *   1. Agrège les comptes 6/7/8 par poste officiel (RA, RB, …, TA,
   *      TB, …, RO, RP, RQ, RS) via `matchPoste` qui projette le code
   *      OHADA sur son poste de rattachement.
   *   2. Évalue la cascade XA → XI selon les formules du Guide
   *      d'application Volume 3 :
   *        XA = TA + RA + RB                (Marge commerciale)
   *        XB = TA + TB + TC + TD           (Chiffre d'affaires)
   *        XC = XB + RA + RB + (TE+TF+TG+TH+TI) − (RC+RD+RE+RF+RG+RH+RI+RJ)
   *        XD = XC + RK                     (EBE)
   *        XE = XD + TJ + RL                (Résultat d'exploitation)
   *        XF = (TK+TL+TM) − RM             (Résultat financier)
   *        XG = XE + XF                     (RAO)
   *        XH = (TN+TO) − (RO+RP)           (RHAO)
   *        XI = XG + XH − RQ − RS           (Résultat net)
   *
   * Convention de signe : les montants par poste sont en VALEUR ABSOLUE
   * (positifs). Les formules portent le signe — RA/RB sont soustraits
   * dans XA, RK dans XD, etc. Le solde net XI peut être négatif (perte).
   */
  async getSig(organizationId: TenantId, query: SigQuery): Promise<SigReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);
    if (query.compareWith !== undefined) {
      this.assertDateRange(query.compareWith.fromDate, query.compareWith.toDate);
    }

    const axis = {
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    };
    const current = await this.computeSigBare(organizationId, query.fromDate, query.toDate, axis);
    if (query.compareWith === undefined) {
      return current;
    }

    const previous = await this.computeSigBare(
      organizationId,
      query.compareWith.fromDate,
      query.compareWith.toDate,
      axis,
    );
    return this.enrichSigWithComparison(current, previous, query.compareWith);
  }

  private async computeSigBare(
    organizationId: TenantId,
    fromDate: string,
    toDate: string,
    axis: { analyticAxisType?: string; analyticAxisCode?: string } = {},
  ): Promise<SigReport> {
    const rows = await this.repo.trialBalance(organizationId, {
      fromDate,
      toDate,
      analyticAxisType: axis.analyticAxisType,
      analyticAxisCode: axis.analyticAxisCode,
    });
    const posteAmounts = new Map<string, number>();

    // Postes de VARIATION de stock (603x → RB/RD/RF) et de PRODUCTION
    // stockée (73 → TG) : leur net peut être légitimement négatif (un
    // stockage réduit le coût des ventes / un déstockage diminue la
    // production). On conserve donc leur signe — l'écrêter à 0
    // sous-évaluerait la marge commerciale et la valeur ajoutée. Les autres
    // postes restent écrêtés (un net négatif y traduit une contre-passation
    // qui ne doit pas distordre la cascade).
    const SIGNED_VARIATION_POSTES = new Set(['RB', 'RD', 'RF', 'TG']);

    for (const row of rows) {
      const poste = matchPoste(row.accountCode);
      if (poste === null) continue;
      const periodD = Number(row.periodDebit);
      const periodC = Number(row.periodCredit);
      const net = poste.side === 'CHARGE' ? periodD - periodC : periodC - periodD;
      const display = SIGNED_VARIATION_POSTES.has(poste.code) ? net : Math.max(net, 0);
      posteAmounts.set(poste.code, (posteAmounts.get(poste.code) ?? 0) + display);
    }

    const get = (code: string): number => posteAmounts.get(code) ?? 0;

    // Cascade SYSCOHADA officielle (Vol. 3 du Guide d'application).
    const XA = get('TA') - get('RA') - get('RB');
    const XB = get('TA') + get('TB') + get('TC') + get('TD');
    const sumOtherProduits = get('TE') + get('TF') + get('TG') + get('TH') + get('TI');
    const sumConsommations =
      get('RC') + get('RD') + get('RE') + get('RF') + get('RG') + get('RH') + get('RI') + get('RJ');
    const XC = XB - get('RA') - get('RB') + sumOtherProduits - sumConsommations;
    const XD = XC - get('RK');
    const XE = XD + get('TJ') - get('RL');
    const XF = get('TK') + get('TL') + get('TM') - get('RM');
    const XG = XE + XF;
    const XH = get('TN') + get('TO') - get('RO') - get('RP');
    const XI = XG + XH - get('RQ') - get('RS');

    const soldeValues: Record<string, number> = {
      XA,
      XB,
      XC,
      XD,
      XE,
      XF,
      XG,
      XH,
      XI,
    };

    const charges: SyscohadaPosteAmount[] = CHARGE_POSTES.map((p) => ({
      code: p.code,
      label: p.label,
      side: 'CHARGE' as const,
      amount: (posteAmounts.get(p.code) ?? 0).toFixed(2),
    }));
    const produits: SyscohadaPosteAmount[] = PRODUIT_POSTES.map((p) => ({
      code: p.code,
      label: p.label,
      side: 'PRODUIT' as const,
      amount: (posteAmounts.get(p.code) ?? 0).toFixed(2),
    }));
    const soldes: SoldeIntermediaire[] = SOLDES_INTERMEDIAIRES.map((s) => ({
      code: s.code,
      label: s.label,
      formula: s.formula,
      amount: soldeValues[s.code].toFixed(2),
    }));

    return {
      fromDate,
      toDate,
      charges,
      produits,
      soldes,
    };
  }

  /**
   * Ratios financiers calculés à partir du bilan + du SIG.
   *
   * Couvre 5 familles :
   *   STRUCTURE     — répartition des emplois/ressources
   *   LIQUIDITE     — capacité à honorer les dettes court terme
   *   SOLVABILITE   — capacité à honorer l'ensemble des dettes
   *   RENTABILITE   — efficacité économique et financière
   *   ACTIVITE      — rotation et délai (BFR, créances clients)
   *
   * Les seuils d'interprétation suivent les normes OHADA usuelles
   * (FANAF, rapports BCEAO). Les ratios à dénominateur nul renvoient
   * `value: null` plutôt qu'une erreur — l'UI affiche `—`.
   */
  async getFinancialRatios(
    organizationId: TenantId,
    query: FinancialRatiosQuery,
  ): Promise<FinancialRatiosReport> {
    assertTenantId(organizationId);
    if (!ReportsService.isYmd(query.asAtDate) || !ReportsService.isYmd(query.fiscalYearStartDate)) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: 'asAtDate and fiscalYearStartDate must be YYYY-MM-DD.',
      });
    }
    if (query.fiscalYearStartDate > query.asAtDate) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: 'fiscalYearStartDate must be <= asAtDate.',
      });
    }

    const [bilan, sig] = await Promise.all([
      this.getBalanceSheet(organizationId, {
        asAtDate: query.asAtDate,
        fiscalYearStartDate: query.fiscalYearStartDate,
      }),
      this.getSig(organizationId, {
        fromDate: query.fiscalYearStartDate,
        toDate: query.asAtDate,
      }),
    ]);

    const sectionTotal = (sections: BalanceSheetReport['actif']['sections'], key: string): number =>
      Number(sections.find((s) => s.key === key)?.total ?? '0');

    const totalActif = Number(bilan.actif.total);
    const totalPassif = Number(bilan.passif.total);
    const actifImmobilise = sectionTotal(bilan.actif.sections, 'IMMOBILISE');
    const actifCirculant = sectionTotal(bilan.actif.sections, 'CIRCULANT');
    const tresoActif = sectionTotal(bilan.actif.sections, 'TRESORERIE_ACTIF');
    const capitauxPropres = sectionTotal(bilan.passif.sections, 'CAPITAUX_PROPRES');
    const dettesFinancieres = sectionTotal(bilan.passif.sections, 'DETTES_FINANCIERES');
    const passifCirculant = sectionTotal(bilan.passif.sections, 'PASSIF_CIRCULANT');
    const tresoPassif = sectionTotal(bilan.passif.sections, 'TRESORERIE_PASSIF');

    const soldeByCode = (code: string): number =>
      Number(sig.soldes.find((s) => s.code === code)?.amount ?? '0');
    const chiffreAffaires = soldeByCode('XB');
    const valeurAjoutee = soldeByCode('XC');
    const ebe = soldeByCode('XD');
    const resultatExploit = soldeByCode('XE');
    const resultatNet = soldeByCode('XI');

    const passifCourtTerme = passifCirculant + tresoPassif;
    const ressourcesStables = capitauxPropres + dettesFinancieres;
    const fondsRoulement = ressourcesStables - actifImmobilise;
    const bfr = actifCirculant - passifCirculant;

    const ratios: FinancialRatio[] = [
      ReportsService.makeRatio({
        code: 'AF',
        label: 'Autonomie financière',
        category: 'STRUCTURE',
        formula: 'Capitaux propres / Total bilan',
        numerator: capitauxPropres,
        denominator: totalPassif,
        unit: 'PERCENT',
        interpret: (v) =>
          v === null ? undefined : v >= 30 ? 'bon (≥ 30 %)' : v >= 20 ? 'à surveiller' : 'faible',
      }),
      ReportsService.makeRatio({
        code: 'EF',
        label: 'Endettement financier',
        category: 'STRUCTURE',
        formula: 'Dettes financières / Capitaux propres',
        numerator: dettesFinancieres,
        denominator: capitauxPropres,
        unit: 'RATIO',
        interpret: (v) =>
          v === null ? undefined : v <= 1 ? 'bon (≤ 1)' : v <= 2 ? 'à surveiller' : 'élevé',
      }),
      ReportsService.makeRatio({
        code: 'FR',
        label: 'Couverture des emplois stables',
        category: 'STRUCTURE',
        formula: 'Ressources stables / Actif immobilisé',
        numerator: ressourcesStables,
        denominator: actifImmobilise,
        unit: 'RATIO',
        interpret: (v) =>
          v === null
            ? undefined
            : v >= 1
              ? 'fonds de roulement positif'
              : 'fonds de roulement négatif',
      }),
      ReportsService.makeRatio({
        code: 'LG',
        label: 'Liquidité générale',
        category: 'LIQUIDITE',
        formula: '(Actif circulant + Trésorerie actif) / Passif court terme',
        numerator: actifCirculant + tresoActif,
        denominator: passifCourtTerme,
        unit: 'RATIO',
        interpret: (v) =>
          v === null ? undefined : v >= 1.5 ? 'bon' : v >= 1 ? 'acceptable' : 'tendu',
      }),
      ReportsService.makeRatio({
        code: 'LI',
        label: 'Liquidité immédiate',
        category: 'LIQUIDITE',
        formula: 'Trésorerie actif / Passif court terme',
        numerator: tresoActif,
        denominator: passifCourtTerme,
        unit: 'RATIO',
        interpret: (v) =>
          v === null ? undefined : v >= 0.2 ? 'bon' : v >= 0.1 ? 'à surveiller' : 'faible',
      }),
      ReportsService.makeRatio({
        code: 'SG',
        label: 'Solvabilité générale',
        category: 'SOLVABILITE',
        formula: 'Total actif / Total dettes',
        numerator: totalActif,
        denominator: dettesFinancieres + passifCourtTerme,
        unit: 'RATIO',
        interpret: (v) =>
          v === null ? undefined : v >= 1.5 ? 'bon' : v >= 1 ? 'limite' : 'critique',
      }),
      ReportsService.makeRatio({
        code: 'RE',
        label: "Rentabilité d'exploitation",
        category: 'RENTABILITE',
        formula: "Résultat d'exploitation / Chiffre d'affaires",
        numerator: resultatExploit,
        denominator: chiffreAffaires,
        unit: 'PERCENT',
      }),
      ReportsService.makeRatio({
        code: 'RC',
        label: 'Rentabilité commerciale (marge nette)',
        category: 'RENTABILITE',
        formula: "Résultat net / Chiffre d'affaires",
        numerator: resultatNet,
        denominator: chiffreAffaires,
        unit: 'PERCENT',
      }),
      ReportsService.makeRatio({
        code: 'RF',
        label: 'Rentabilité financière (ROE)',
        category: 'RENTABILITE',
        formula: 'Résultat net / Capitaux propres',
        numerator: resultatNet,
        denominator: capitauxPropres,
        unit: 'PERCENT',
        interpret: (v) =>
          v === null ? undefined : v >= 10 ? 'bon (≥ 10 %)' : v >= 5 ? 'modéré' : 'faible',
      }),
      ReportsService.makeRatio({
        code: 'RA',
        label: "Rentabilité économique de l'actif",
        category: 'RENTABILITE',
        formula: 'EBE / Total actif',
        numerator: ebe,
        denominator: totalActif,
        unit: 'PERCENT',
      }),
      ReportsService.makeRatio({
        code: 'VA',
        label: 'Productivité — VA / CA',
        category: 'ACTIVITE',
        formula: "Valeur ajoutée / Chiffre d'affaires",
        numerator: valeurAjoutee,
        denominator: chiffreAffaires,
        unit: 'PERCENT',
      }),
      ReportsService.makeRatio({
        code: 'BFR',
        label: 'Poids du BFR',
        category: 'ACTIVITE',
        formula: "Besoin en fonds de roulement / Chiffre d'affaires (en jours)",
        numerator: bfr * 360,
        denominator: chiffreAffaires,
        unit: 'DAYS',
      }),
      ReportsService.makeRatio({
        code: 'FRNG',
        label: 'Fonds de roulement net global',
        category: 'STRUCTURE',
        formula: 'Ressources stables − Actif immobilisé',
        numerator: fondsRoulement,
        denominator: 1, // valeur absolue, pas un quotient
        unit: 'RATIO',
        interpret: () => (fondsRoulement >= 0 ? 'positif' : 'négatif (déséquilibre structurel)'),
      }),
    ];

    return {
      asAtDate: query.asAtDate,
      fiscalYearStartDate: query.fiscalYearStartDate,
      ratios,
    };
  }

  /**
   * Trésorerie nette glissante mois par mois sur [fromMonth, toMonth].
   * Pour chaque mois : solde cumulé des comptes de classe 5 au dernier
   * jour calendaire. Un solde créditeur (découvert) vient en déduction.
   *
   * Implémentation : N appels parallèles à `accountBalancesAsAt`. Garde-
   * fou à 60 mois ; au-delà demander un découpage.
   */
  async getCashTrend(organizationId: TenantId, query: CashTrendQuery): Promise<CashTrendReport> {
    assertTenantId(organizationId);
    if (
      !ReportsService.isYearMonth(query.fromMonth) ||
      !ReportsService.isYearMonth(query.toMonth)
    ) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: 'fromMonth and toMonth must be YYYY-MM.',
      });
    }
    if (query.fromMonth > query.toMonth) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: 'fromMonth must be <= toMonth.',
      });
    }
    const months = ReportsService.enumerateMonths(query.fromMonth, query.toMonth);
    if (months.length > 60) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: 'Cash trend window cannot exceed 60 months — split into chunks.',
      });
    }

    const balancesByMonth = await Promise.all(
      months.map(async (m) => {
        const asAtDate = ReportsService.lastDayOfMonth(m);
        const rows = await this.repo.accountBalancesAsAt(organizationId, asAtDate);
        let totalDebit = 0;
        let totalCredit = 0;
        for (const r of rows) {
          if (r.accountClass !== 5) continue;
          const net = Number(r.totalDebit) - Number(r.totalCredit);
          if (net >= 0) {
            totalDebit += net;
          } else {
            totalCredit += -net;
          }
        }
        return { yearMonth: m, asAtDate, totalDebit, totalCredit };
      }),
    );

    const points: CashTrendPoint[] = balancesByMonth.map((b, idx) => {
      const net = b.totalDebit - b.totalCredit;
      const previous =
        idx === 0
          ? null
          : balancesByMonth[idx - 1].totalDebit - balancesByMonth[idx - 1].totalCredit;
      return {
        yearMonth: b.yearMonth,
        asAtDate: b.asAtDate,
        totalDebit: b.totalDebit.toFixed(2),
        totalCredit: b.totalCredit.toFixed(2),
        netCash: net.toFixed(2),
        change: previous === null ? null : (net - previous).toFixed(2),
      };
    });

    const nets = points.map((p) => Number(p.netCash));
    return {
      fromMonth: query.fromMonth,
      toMonth: query.toMonth,
      points,
      currentNetCash: nets[nets.length - 1].toFixed(2),
      minNetCash: Math.min(...nets).toFixed(2),
      maxNetCash: Math.max(...nets).toFixed(2),
    };
  }

  // ───────────────────────────────────────────────────────────────
  // `getTft` (legacy TFT méthode indirecte basée sur le bilan) a été
  // SUPPRIMÉ (B4). Le TFT officiel doctrinal Tome 3 p. 34 est désormais
  // exposé uniquement via `CashFlowService.getCashFlow`, qui retourne
  // un `CashFlowReport` (codes ZA → ZH, postes FA → FQ). Tous les call
  // sites (controller `/tft*`, `ReportsPackageService`,
  // `FiscalYearSnapshotsService`) ont été migrés.
  // ───────────────────────────────────────────────────────────────

  /**
   * Squelette de l'Annexe (Notes 1 à 35) SYSCOHADA AUDCIF.
   *
   * V1 : retourne la liste officielle des notes avec leur titre et leur
   * statut. Les notes calculables automatiquement (immobilisations, stocks,
   * créances, dettes, capitaux) sont marquées COMPUTED avec lien vers le
   * rapport source. Les notes purement narratives sont marquées MANUAL.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- public async contract; assembles the annexe from already-resolved inputs.
  async getAnnexe(
    organizationId: TenantId,
    query: { asAtDate: string; fiscalYearStartDate: string },
  ): Promise<AnnexeReport> {
    assertTenantId(organizationId);
    if (!ReportsService.isYmd(query.asAtDate) || !ReportsService.isYmd(query.fiscalYearStartDate)) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: 'Both dates must be YYYY-MM-DD.',
      });
    }

    const notes: AnnexeNote[] = [
      { code: 'Note 1', title: 'Règles et méthodes comptables', status: 'MANUAL' },
      {
        code: 'Note 3A',
        title: 'Immobilisations brutes',
        status: 'COMPUTED',
        source: 'balance-sheet (classe 2)',
      },
      {
        code: 'Note 3B',
        title: 'Amortissements et provisions sur immobilisations',
        status: 'COMPUTED',
        source: 'balance-sheet (comptes 28x, 29x)',
      },
      {
        code: 'Note 3C',
        title: 'Dotations / reprises de la période',
        status: 'COMPUTED',
        source: 'sig (RL, TJ)',
      },
      {
        code: 'Note 3D',
        title: "Cessions d'immobilisations",
        status: 'PARTIAL',
        source: 'sig (TN, RO)',
      },
      { code: 'Note 3E', title: 'Crédit-bail et contrats assimilés', status: 'MANUAL' },
      {
        code: 'Note 3F',
        title: "Subventions d'investissement",
        status: 'COMPUTED',
        source: 'balance-sheet (compte 14)',
      },
      {
        code: 'Note 4',
        title: 'Stocks et en-cours',
        status: 'COMPUTED',
        source: 'balance-sheet (classe 3)',
      },
      {
        code: 'Note 5',
        title: 'Créances et emplois assimilés',
        status: 'COMPUTED',
        source: 'aging-balance (CLIENT)',
      },
      {
        code: 'Note 6',
        title: 'Variations de stocks',
        status: 'COMPUTED',
        source: 'sig (RB, RD, RF, TG)',
      },
      {
        code: 'Note 7',
        title: "Charges constatées d'avance",
        status: 'COMPUTED',
        source: 'balance-sheet (compte 476)',
      },
      {
        code: 'Note 8',
        title: 'Trésorerie actif',
        status: 'COMPUTED',
        source: 'balance-sheet (classe 5 débit)',
      },
      { code: 'Note 9', title: 'Écarts de conversion', status: 'MANUAL' },
      {
        code: 'Note 10',
        title: 'Capital social',
        status: 'COMPUTED',
        source: 'balance-sheet (compte 10)',
      },
      {
        code: 'Note 11',
        title: 'Primes, réserves, report à nouveau',
        status: 'COMPUTED',
        source: 'balance-sheet (comptes 11, 12)',
      },
      {
        code: 'Note 12',
        title: "Subventions d'investissement",
        status: 'COMPUTED',
        source: 'balance-sheet (compte 14)',
      },
      {
        code: 'Note 13',
        title: 'Provisions pour risques et charges',
        status: 'COMPUTED',
        source: 'balance-sheet (compte 19)',
      },
      {
        code: 'Note 14',
        title: 'Emprunts et dettes financières',
        status: 'COMPUTED',
        source: 'balance-sheet (classe 16)',
      },
      {
        code: 'Note 15',
        title: 'Fournisseurs et dettes assimilées',
        status: 'COMPUTED',
        source: 'aging-balance (FOURNISSEUR)',
      },
      {
        code: 'Note 16',
        title: 'Dettes sociales et fiscales',
        status: 'COMPUTED',
        source: 'balance-sheet (comptes 42, 43, 44)',
      },
      {
        code: 'Note 17',
        title: 'Autres dettes',
        status: 'COMPUTED',
        source: 'balance-sheet (autres 4x crédit)',
      },
      {
        code: 'Note 18',
        title: 'Trésorerie passif',
        status: 'COMPUTED',
        source: 'balance-sheet (classe 5 crédit)',
      },
      { code: 'Note 19', title: 'Engagements donnés et reçus (hors bilan)', status: 'MANUAL' },
      {
        code: 'Note 20',
        title: "Ventilation du chiffre d'affaires",
        status: 'COMPUTED',
        source: 'sig (TA-TD)',
      },
      {
        code: 'Note 21',
        title: 'Produits, charges hors activités ordinaires (HAO)',
        status: 'COMPUTED',
        source: 'sig (TN, TO, RO, RP)',
      },
      {
        code: 'Note 22',
        title: 'Charges et produits financiers',
        status: 'COMPUTED',
        source: 'sig (TK-TM, RM)',
      },
      {
        code: 'Note 23',
        title: 'Effectifs, masse salariale, personnel extérieur',
        status: 'PARTIAL',
        source: 'sig (RK)',
      },
      { code: 'Note 24', title: 'Rémunérations et avantages des dirigeants', status: 'MANUAL' },
      { code: 'Note 25', title: 'Transactions avec parties liées', status: 'MANUAL' },
      { code: 'Note 26', title: 'Événements postérieurs à la clôture', status: 'MANUAL' },
      { code: 'Note 27', title: 'Honoraires des commissaires aux comptes', status: 'MANUAL' },
      { code: 'Note 28', title: 'Impôt sur les bénéfices', status: 'COMPUTED', source: 'sig (RS)' },
      { code: 'Note 29', title: 'Activités abandonnées ou cédées', status: 'MANUAL' },
      { code: 'Note 30', title: 'Information sectorielle', status: 'MANUAL' },
      { code: 'Note 35', title: 'Tableau des engagements financiers', status: 'MANUAL' },
      { code: 'Note 36', title: 'Identité et informations générales', status: 'MANUAL' },
    ];

    return {
      asAtDate: query.asAtDate,
      fiscalYearStartDate: query.fiscalYearStartDate,
      notes,
    };
  }

  /**
   * Détail concret d'une note d'annexe. V1 implémente 4 notes phares :
   *   - Note 3A : Immobilisations brutes par catégorie (préfixe 21/22/23/24/25)
   *   - Note 5  : Créances et emplois assimilés par sous-compte (411)
   *   - Note 15 : Dettes fournisseurs par sous-compte (401)
   *   - Note 20 : Ventilation du chiffre d'affaires (postes TA/TB/TC/TD)
   *
   * Pour les autres notes, retourne `coverage: 'UNSUPPORTED'` avec une
   * indication de la méthodologie attendue.
   */
  async getAnnexeNoteDetail(
    organizationId: TenantId,
    query: { noteCode: string; asAtDate: string; fiscalYearStartDate: string },
  ): Promise<AnnexeNoteDetailReport> {
    assertTenantId(organizationId);
    if (!ReportsService.isYmd(query.asAtDate) || !ReportsService.isYmd(query.fiscalYearStartDate)) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: 'Both dates must be YYYY-MM-DD.',
      });
    }

    switch (query.noteCode) {
      case 'Note 3A':
        return this.computeNote3A(organizationId, query.asAtDate, query.fiscalYearStartDate);
      case 'Note 3B':
        return this.computeNote3B(organizationId, query.asAtDate, query.fiscalYearStartDate);
      case 'Note 5':
        return this.computeNote5(organizationId, query.asAtDate, query.fiscalYearStartDate);
      case 'Note 14':
        return this.computeNote14(organizationId, query.asAtDate, query.fiscalYearStartDate);
      case 'Note 15':
        return this.computeNote15(organizationId, query.asAtDate, query.fiscalYearStartDate);
      case 'Note 20':
        return this.computeNote20(organizationId, query.asAtDate, query.fiscalYearStartDate);
      case 'Note 28':
        return this.computeNote28(organizationId, query.asAtDate, query.fiscalYearStartDate);
      default:
        return {
          noteCode: query.noteCode,
          title: 'Note non implémentée en détail (V1)',
          asAtDate: query.asAtDate,
          fiscalYearStartDate: query.fiscalYearStartDate,
          rows: [],
          total: '0.00',
          coverage: 'UNSUPPORTED',
          methodology:
            "Cette note n'a pas encore de calcul détaillé. Voir la liste générale via /annexe pour le statut COMPUTED/PARTIAL/MANUAL et la source.",
        };
    }
  }

  private async computeNote3A(
    organizationId: TenantId,
    asAtDate: string,
    fyStart: string,
  ): Promise<AnnexeNoteDetailReport> {
    const balances = await this.repo.accountBalancesAsAt(organizationId, asAtDate);
    // Immobilisations brutes : préfixes 20-26 (incorporel, corporel,
    // financier). On EXCLUT les amortissements (28x) et dépréciations
    // (29x) — la note 3A traite la valeur brute.
    const categories: ReadonlyArray<{ prefix: string; label: string }> = [
      { prefix: '21', label: 'Immobilisations incorporelles' },
      { prefix: '22', label: 'Terrains' },
      { prefix: '23', label: 'Bâtiments, installations techniques et agencements' },
      { prefix: '24', label: 'Matériel, mobilier et actifs biologiques' },
      { prefix: '25', label: 'Avances et acomptes versés sur immobilisations' },
      { prefix: '26', label: 'Titres de participation' },
      { prefix: '27', label: 'Autres immobilisations financières' },
    ];
    const rows: AnnexeNoteDetailRow[] = [];
    let total = 0;
    for (const cat of categories) {
      const subBalances = balances.filter(
        (b) =>
          b.accountCode.startsWith(cat.prefix) &&
          !b.accountCode.startsWith('28') &&
          !b.accountCode.startsWith('29'),
      );
      if (subBalances.length === 0) continue;
      const subRows: AnnexeNoteDetailRow[] = subBalances.map((b) => ({
        code: b.accountCode,
        label: b.accountLabel,
        amount: (Number(b.totalDebit) - Number(b.totalCredit)).toFixed(2),
      }));
      const catTotal = subRows.reduce((s, r) => s + Number(r.amount), 0);
      total += catTotal;
      rows.push({
        code: cat.prefix,
        label: cat.label,
        amount: catTotal.toFixed(2),
        subRows,
      });
    }
    return {
      noteCode: 'Note 3A',
      title: 'Immobilisations brutes par catégorie',
      asAtDate,
      fiscalYearStartDate: fyStart,
      rows,
      total: total.toFixed(2),
      coverage: 'COMPLETE',
      methodology:
        'Valeur brute = solde net des comptes 20-27 à la date. Les amortissements (28x) et dépréciations (29x) sont traités séparément (Note 3B).',
    };
  }

  private async computeNote5(
    organizationId: TenantId,
    asAtDate: string,
    fyStart: string,
  ): Promise<AnnexeNoteDetailReport> {
    const balances = await this.repo.accountBalancesAsAt(organizationId, asAtDate);
    // Créances : sous-comptes 411 (clients) + 416 (clients douteux) +
    // 418 (factures à établir) + autres créances 42x débit, 44x débit,
    // 47x débit. V1 : se limiter à 411 pour rester actionnable.
    const filtered = balances.filter(
      (b) =>
        b.accountCode.startsWith('411') && Number(b.totalDebit) - Number(b.totalCredit) > 0.005,
    );
    const rows: AnnexeNoteDetailRow[] = filtered.map((b) => ({
      code: b.accountCode,
      label: b.accountLabel,
      amount: (Number(b.totalDebit) - Number(b.totalCredit)).toFixed(2),
    }));
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    return {
      noteCode: 'Note 5',
      title: 'Créances clients et emplois assimilés',
      asAtDate,
      fiscalYearStartDate: fyStart,
      rows,
      total: total.toFixed(2),
      coverage: 'PARTIAL',
      methodology:
        'V1 : sous-comptes 411 (clients) avec solde débiteur positif. À étendre : 416 (clients douteux), 418 (factures à établir), 425-427 (avances personnel). Pour le détail âge des créances, voir /aging-balance?side=CLIENT.',
    };
  }

  private async computeNote15(
    organizationId: TenantId,
    asAtDate: string,
    fyStart: string,
  ): Promise<AnnexeNoteDetailReport> {
    const balances = await this.repo.accountBalancesAsAt(organizationId, asAtDate);
    const filtered = balances.filter(
      (b) =>
        b.accountCode.startsWith('401') && Number(b.totalCredit) - Number(b.totalDebit) > 0.005,
    );
    const rows: AnnexeNoteDetailRow[] = filtered.map((b) => ({
      code: b.accountCode,
      label: b.accountLabel,
      amount: (Number(b.totalCredit) - Number(b.totalDebit)).toFixed(2),
    }));
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    return {
      noteCode: 'Note 15',
      title: 'Fournisseurs et dettes assimilées',
      asAtDate,
      fiscalYearStartDate: fyStart,
      rows,
      total: total.toFixed(2),
      coverage: 'PARTIAL',
      methodology:
        'V1 : sous-comptes 401 (fournisseurs) avec solde créditeur positif. À étendre : 408 (fournisseurs factures non parvenues), 409 (avances versées en déduction). Pour le détail âge des dettes, voir /aging-balance?side=FOURNISSEUR.',
    };
  }

  private async computeNote20(
    organizationId: TenantId,
    asAtDate: string,
    fyStart: string,
  ): Promise<AnnexeNoteDetailReport> {
    // Ventilation du CA : on agrège la période [fyStart, asAtDate] par
    // poste TA (701) / TB (702) / TC (704-706) / TD (707). Source :
    // SIG sur la période demandée.
    const sig = await this.getSig(organizationId, { fromDate: fyStart, toDate: asAtDate });
    const labels: Record<string, string> = {
      TA: 'Ventes de marchandises',
      TB: 'Ventes de produits fabriqués',
      TC: 'Travaux, services vendus',
      TD: 'Produits accessoires',
    };
    const rows: AnnexeNoteDetailRow[] = [];
    let total = 0;
    for (const code of ['TA', 'TB', 'TC', 'TD']) {
      const poste = sig.produits.find((p) => p.code === code);
      if (poste === undefined) continue;
      const amt = Number(poste.amount);
      if (amt < 0.005) continue;
      rows.push({
        code,
        label: labels[code] ?? poste.label,
        amount: poste.amount,
      });
      total += amt;
    }
    return {
      noteCode: 'Note 20',
      title: "Ventilation du chiffre d'affaires",
      asAtDate,
      fiscalYearStartDate: fyStart,
      rows,
      total: total.toFixed(2),
      coverage: 'COMPLETE',
      methodology:
        "Chiffre d'affaires SYSCOHADA = somme des postes TA (compte 701) + TB (702) + TC (704-706) + TD (707) sur la période [début exercice, asAtDate]. Cf. poste XB du SIG.",
    };
  }

  private async computeNote3B(
    organizationId: TenantId,
    asAtDate: string,
    fyStart: string,
  ): Promise<AnnexeNoteDetailReport> {
    const balances = await this.repo.accountBalancesAsAt(organizationId, asAtDate);
    // Amortissements (28x) + dépréciations (29x) sur immobilisations.
    const filtered = balances.filter(
      (b) => b.accountCode.startsWith('28') || b.accountCode.startsWith('29'),
    );
    const amortRows = filtered
      .filter((b) => b.accountCode.startsWith('28'))
      .map((b) => ({
        code: b.accountCode,
        label: b.accountLabel,
        amount: (Number(b.totalCredit) - Number(b.totalDebit)).toFixed(2),
      }));
    const deprRows = filtered
      .filter((b) => b.accountCode.startsWith('29'))
      .map((b) => ({
        code: b.accountCode,
        label: b.accountLabel,
        amount: (Number(b.totalCredit) - Number(b.totalDebit)).toFixed(2),
      }));
    const amortTotal = amortRows.reduce((s, r) => s + Number(r.amount), 0);
    const deprTotal = deprRows.reduce((s, r) => s + Number(r.amount), 0);
    const rows: AnnexeNoteDetailRow[] = [
      ...(amortRows.length > 0
        ? [
            {
              code: '28',
              label: 'Amortissements des immobilisations',
              amount: amortTotal.toFixed(2),
              subRows: amortRows,
            },
          ]
        : []),
      ...(deprRows.length > 0
        ? [
            {
              code: '29',
              label: 'Dépréciations des immobilisations',
              amount: deprTotal.toFixed(2),
              subRows: deprRows,
            },
          ]
        : []),
    ];
    return {
      noteCode: 'Note 3B',
      title: 'Amortissements et dépréciations des immobilisations',
      asAtDate,
      fiscalYearStartDate: fyStart,
      rows,
      total: (amortTotal + deprTotal).toFixed(2),
      coverage: 'COMPLETE',
      methodology:
        'Solde net créditeur des comptes 28 (amortissements) et 29 (dépréciations). Pour les dotations de la période, voir Note 3C (basée sur le poste RL du SIG).',
    };
  }

  private async computeNote14(
    organizationId: TenantId,
    asAtDate: string,
    fyStart: string,
  ): Promise<AnnexeNoteDetailReport> {
    const balances = await this.repo.accountBalancesAsAt(organizationId, asAtDate);
    // Emprunts et dettes financières — préfixe 16 (emprunts auprès des
    // établissements financiers, dettes financières diverses, dépôts et
    // cautionnements reçus).
    const filtered = balances.filter(
      (b) => b.accountCode.startsWith('16') && Number(b.totalCredit) - Number(b.totalDebit) > 0.005,
    );
    const rows: AnnexeNoteDetailRow[] = filtered.map((b) => ({
      code: b.accountCode,
      label: b.accountLabel,
      amount: (Number(b.totalCredit) - Number(b.totalDebit)).toFixed(2),
    }));
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    return {
      noteCode: 'Note 14',
      title: 'Emprunts et dettes financières',
      asAtDate,
      fiscalYearStartDate: fyStart,
      rows,
      total: total.toFixed(2),
      coverage: 'PARTIAL',
      methodology:
        "Solde créditeur des comptes 16x à la date. Pour la ventilation par échéance (< 1 an / 1-5 ans / > 5 ans), il faut un champ d'échéance par ligne d'emprunt — pas encore dans le modèle de données. À ce stade, l'agrégat global est livré.",
    };
  }

  private async computeNote28(
    organizationId: TenantId,
    asAtDate: string,
    fyStart: string,
  ): Promise<AnnexeNoteDetailReport> {
    // Impôt sur le résultat : poste RS = compte 89 sur la période.
    const sig = await this.getSig(organizationId, { fromDate: fyStart, toDate: asAtDate });
    const rs = sig.charges.find((c) => c.code === 'RS');
    const rq = sig.charges.find((c) => c.code === 'RQ');
    const xi = sig.soldes.find((s) => s.code === 'XI');
    const xg = sig.soldes.find((s) => s.code === 'XG');
    const rows: AnnexeNoteDetailRow[] = [
      {
        code: 'XG',
        label: 'Résultat des activités ordinaires (avant impôt et participation)',
        amount: xg?.amount ?? '0.00',
      },
      {
        code: 'RQ',
        label: 'Participation des travailleurs',
        amount: rq?.amount ?? '0.00',
      },
      {
        code: 'RS',
        label: 'Impôt sur le résultat (charge)',
        amount: rs?.amount ?? '0.00',
      },
      {
        code: 'XI',
        label: "Résultat net de l'exercice",
        amount: xi?.amount ?? '0.00',
      },
    ];
    return {
      noteCode: 'Note 28',
      title: 'Impôt sur les bénéfices',
      asAtDate,
      fiscalYearStartDate: fyStart,
      rows,
      total: rs?.amount ?? '0.00',
      coverage: 'COMPLETE',
      methodology:
        "Charge d'impôt = poste RS (compte 89) du SIG sur la période. Le rapprochement résultat avant impôt → impôt comptable → impôt courant nécessiterait le suivi des différences temporelles (IS différé, déficits reportables) qui n'est pas modélisé en V1.",
    };
  }

  /** Helper : retourne la veille en ISO (`YYYY-MM-DD`). */
  static previousDayIso(dateIso: string): string {
    const d = new Date(`${dateIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  /** Helper : début d'exercice précédent (heuristique : −1 an pile). */
  static previousFiscalYearStart(fyStartIso: string): string {
    const d = new Date(`${fyStartIso}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Balance âgée standardisée Tome 3 (Notes 7 & 17).
   *
   * Buckets figés : `0-30j` / `31-60j` / `61-90j` / `>90j` (cf.
   * `AGING_BUCKET_BOUNDARIES`). Le paramètre `bucketBoundaries` de la
   * requête est accepté pour rétro-compat mais ignoré : la doctrine
   * SYSCOHADA fixe ces tranches pour les Notes annexes.
   *
   * Périmètre comptes (élargi vs V0) :
   *   - CLIENT      : 411 (clients), 412 (effets à recevoir),
   *                   416 (créances douteuses), 418 (clients fact. à émettre)
   *   - FOURNISSEUR : 401 (fournisseurs), 402 (effets à payer),
   *                   403 (fournisseurs effets à payer), 408 (fact. non parv.)
   *
   * Imputation FIFO : sans lettrage explicite, chaque règlement éteint
   * les factures les plus anciennes (algorithme conservé de la V0).
   */
  async getAgingBalance(
    organizationId: TenantId,
    query: AgingBalanceQuery,
  ): Promise<AgingBalanceReport> {
    assertTenantId(organizationId);
    if (!ReportsService.isYmd(query.asAtDate)) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: 'asAtDate must be YYYY-MM-DD.',
      });
    }

    // Buckets figés Tome 3 — `bucketBoundaries` (query) ignoré.
    const sortedBoundaries = [...AGING_BUCKET_BOUNDARIES];
    const bucketCount = AGING_BUCKET_LABELS.length;
    const prefixes = AGING_PREFIXES[query.side];

    const balances = await this.repo.accountBalancesAsAt(organizationId, query.asAtDate);
    const partners = balances.filter(
      (b) =>
        prefixes.some((p) => b.accountCode.startsWith(p)) &&
        (Number(b.totalDebit) !== 0 || Number(b.totalCredit) !== 0),
    );
    const asAt = new Date(`${query.asAtDate}T00:00:00Z`).getTime();
    const openCreatesDebit = query.side === 'CLIENT';

    const rows: AgingAccountRow[] = await Promise.all(
      partners.map(async (p) => {
        const lines = await this.repo.generalLedger(organizationId, {
          accountId: p.accountId,
          fromDate: '1900-01-01',
          toDate: query.asAtDate,
        });
        const opens: { date: number; amount: number }[] = [];
        for (const ln of lines) {
          const net = Number(ln.debit) - Number(ln.credit);
          if (net === 0) continue;
          const isOpen = openCreatesDebit ? net > 0 : net < 0;
          const amt = Math.abs(net);
          // Vieillissement à l'échéance : on date la créance/dette par sa
          // date d'échéance (`dueDate`) si renseignée, sinon par sa date de
          // comptabilisation (fallback = comportement historique). L'ordre
          // d'imputation FIFO reste chronologique (lignes triées par
          // entry_date côté repo).
          const ageRef = ln.dueDate ?? ln.entryDate;
          const date = new Date(`${ageRef}T00:00:00Z`).getTime();
          if (isOpen) {
            opens.push({ date, amount: amt });
          } else {
            let remaining = amt;
            while (remaining > 0 && opens.length > 0) {
              const head = opens[0];
              if (head.amount <= remaining) {
                remaining -= head.amount;
                opens.shift();
              } else {
                head.amount -= remaining;
                remaining = 0;
              }
            }
          }
        }
        // Placement âge → bucket Tome 3 :
        //   ageDays ≤ 30   → 0-30j
        //   31..60         → 31-60j
        //   61..90         → 61-90j
        //   ageDays > 90   → >90j
        const bucketAmounts: number[] = new Array<number>(bucketCount).fill(0);
        for (const o of opens) {
          const ageDays = Math.max(0, Math.floor((asAt - o.date) / (1000 * 60 * 60 * 24)));
          let placed = false;
          for (let i = 0; i < sortedBoundaries.length; i += 1) {
            if (ageDays <= sortedBoundaries[i]) {
              bucketAmounts[i] += o.amount;
              placed = true;
              break;
            }
          }
          if (!placed) bucketAmounts[bucketCount - 1] += o.amount;
        }
        const buckets: AgingBucket[] = AGING_BUCKET_LABELS.map((label, i) => ({
          upperDays: i < sortedBoundaries.length ? sortedBoundaries[i] : null,
          label,
          amount: bucketAmounts[i].toFixed(2),
        }));
        const total = bucketAmounts.reduce((s: number, x: number) => s + x, 0);
        return {
          accountId: p.accountId,
          accountCode: p.accountCode,
          accountLabel: p.accountLabel,
          total: total.toFixed(2),
          buckets,
        };
      }),
    );
    const filtered = rows.filter((r) => Number(r.total) > 0.005);
    filtered.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    const bucketTotals: number[] = new Array<number>(bucketCount).fill(0);
    for (const r of filtered) {
      r.buckets.forEach((b, i) => {
        bucketTotals[i] += Number(b.amount);
      });
    }
    const grandTotal = bucketTotals.reduce((s: number, x: number) => s + x, 0);
    return {
      side: query.side,
      asAtDate: query.asAtDate,
      bucketBoundaries: sortedBoundaries,
      rows: filtered,
      bucketTotals: bucketTotals.map((n: number) => n.toFixed(2)),
      grandTotal: grandTotal.toFixed(2),
    };
  }

  static isYearMonth(s: string): boolean {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  }

  static enumerateMonths(from: string, to: string): string[] {
    const [fy, fm] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    const months: string[] = [];
    let y = fy;
    let m = fm;
    while (y < ty || (y === ty && m <= tm)) {
      months.push(`${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return months;
  }

  static lastDayOfMonth(yearMonth: string): string {
    const [y, m] = yearMonth.split('-').map(Number);
    const d = new Date(Date.UTC(y, m, 0));
    return d.toISOString().slice(0, 10);
  }

  private static makeRatio(args: {
    code: string;
    label: string;
    category: RatioCategory;
    formula: string;
    numerator: number;
    denominator: number;
    unit: 'PERCENT' | 'RATIO' | 'DAYS';
    /**
     * Le numérique passé à `interpret` est dans l'unité d'affichage :
     *   - PERCENT → la valeur en pourcent (44.44, pas 0.4444)
     *   - RATIO   → la valeur brute (0.5)
     *   - DAYS    → le nombre de jours
     * Les seuils dans la lambda sont donc lisibles directement.
     */
    interpret?: (v: number | null) => string | undefined;
  }): FinancialRatio {
    const denomZero = Math.abs(args.denominator) < 0.005;
    const raw = denomZero ? null : args.numerator / args.denominator;
    const displayValue =
      raw === null
        ? null
        : args.unit === 'PERCENT'
          ? raw * 100
          : args.unit === 'DAYS'
            ? Math.round(raw)
            : raw;
    const value =
      displayValue === null
        ? null
        : args.unit === 'PERCENT'
          ? displayValue.toFixed(2)
          : args.unit === 'DAYS'
            ? displayValue.toString()
            : displayValue.toFixed(4);
    return {
      code: args.code,
      label: args.label,
      category: args.category,
      formula: args.formula,
      numerator: args.numerator.toFixed(2),
      denominator: args.denominator.toFixed(2),
      value,
      unit: args.unit,
      interpretation: args.interpret?.(displayValue),
    };
  }

  private enrichSigWithComparison(
    current: SigReport,
    previous: SigReport,
    previousRange: { fromDate: string; toDate: string },
  ): SigReport {
    const indexByCode = (items: readonly SyscohadaPosteAmount[]) =>
      new Map(items.map((a) => [a.code, a]));
    const prevCharges = indexByCode(previous.charges);
    const prevProduits = indexByCode(previous.produits);
    const prevSoldes = new Map(previous.soldes.map((s) => [s.code, s]));

    const enrichPoste = (
      poste: SyscohadaPosteAmount,
      prevMap: Map<string, SyscohadaPosteAmount>,
    ): SyscohadaPosteAmount => {
      const prev = prevMap.get(poste.code);
      return { ...poste, previousAmount: prev?.amount ?? '0.00' };
    };

    const enrichSolde = (s: SoldeIntermediaire): SoldeIntermediaire => {
      const prev = prevSoldes.get(s.code);
      const prevAmount = prev ? Number(prev.amount) : 0;
      const curAmount = Number(s.amount);
      const variation = curAmount - prevAmount;
      return {
        ...s,
        previousAmount: prevAmount.toFixed(2),
        variation: variation.toFixed(2),
        variationPercent: ReportsService.percentChange(prevAmount, curAmount),
      };
    };

    return {
      ...current,
      charges: current.charges.map((p) => enrichPoste(p, prevCharges)),
      produits: current.produits.map((p) => enrichPoste(p, prevProduits)),
      soldes: current.soldes.map(enrichSolde),
      previous: { fromDate: previousRange.fromDate, toDate: previousRange.toDate },
    };
  }

  private computeComparativeTotals(
    rows: readonly ComparativeBalanceRow[],
  ): ComparativeBalanceTotals {
    const sum = (key: keyof ComparativeBalanceRow): number =>
      rows.reduce((s, r) => s + Number(r[key] as string), 0);
    return {
      previousPeriodDebit: sum('previousPeriodDebit').toFixed(2),
      previousPeriodCredit: sum('previousPeriodCredit').toFixed(2),
      periodDebit: sum('periodDebit').toFixed(2),
      periodCredit: sum('periodCredit').toFixed(2),
      endingDebit: sum('endingDebit').toFixed(2),
      endingCredit: sum('endingCredit').toFixed(2),
    };
  }

  /**
   * Balance pluri-exercices : généralisation de la balance comparative à
   * N périodes (typiquement N, N-1, N-2 pour les audits SYSCOHADA).
   * Solde = endingDebit/Credit à la fin de la DERNIÈRE période.
   */
  async getMultiYearBalance(
    organizationId: TenantId,
    query: MultiYearBalanceQuery,
  ): Promise<MultiYearBalanceReport> {
    assertTenantId(organizationId);
    if (query.periods.length < 2 || query.periods.length > 5) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: 'Multi-year balance requires 2 to 5 periods.',
      });
    }
    for (const p of query.periods) {
      this.assertDateRange(p.fromDate, p.toDate);
    }
    const filters = {
      accountClass: query.accountClass,
      accountCodeFrom: query.accountCodeFrom,
      accountCodeTo: query.accountCodeTo,
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    };
    const perPeriodRows = await Promise.all(
      query.periods.map((p) =>
        this.repo.trialBalance(organizationId, {
          ...filters,
          fromDate: p.fromDate,
          toDate: p.toDate,
        }),
      ),
    );
    const lastIdx = perPeriodRows.length - 1;
    const indexByAccount = perPeriodRows.map((rows) => new Map(rows.map((r) => [r.accountId, r])));
    const allAccountIds = new Set<string>();
    for (const rows of perPeriodRows) {
      for (const r of rows) allAccountIds.add(r.accountId);
    }
    const merged: MultiYearBalanceRow[] = [];
    for (const accountId of allAccountIds) {
      const sample = indexByAccount.find((m) => m.has(accountId))?.get(accountId);
      if (sample === undefined) continue;
      const netByPeriod = indexByAccount.map((m) => {
        const r = m.get(accountId);
        if (r === undefined) return '0.00';
        return (Number(r.periodDebit) - Number(r.periodCredit)).toFixed(2);
      });
      const last = indexByAccount[lastIdx].get(accountId);
      const endingDebit = last?.endingDebit ?? '0.00';
      const endingCredit = last?.endingCredit ?? '0.00';
      merged.push({
        accountId,
        accountCode: sample.accountCode,
        accountLabel: sample.accountLabel,
        accountClass: sample.accountClass,
        netByPeriod,
        endingDebit,
        endingCredit,
      });
    }
    merged.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    const filtered =
      query.hideEmpty === true
        ? merged.filter(
            (r) =>
              r.netByPeriod.some((n) => Number(n) !== 0) ||
              Number(r.endingDebit) !== 0 ||
              Number(r.endingCredit) !== 0,
          )
        : merged;
    return { periods: query.periods, rows: filtered };
  }

  async getGeneralLedger(
    organizationId: TenantId,
    query: GeneralLedgerQuery,
  ): Promise<GeneralLedgerReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);

    const account = await this.accounts.findById(query.accountId, organizationId);
    if (account === null) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_FOUND, {
        message: `Account ${query.accountId} not found in this organisation.`,
      });
    }

    const [rawLines, opening] = await Promise.all([
      this.repo.generalLedger(organizationId, query),
      this.repo.generalLedgerOpening(organizationId, query.accountId, query.fromDate),
    ]);

    // Compute running balance starting from opening (debit positive,
    // credit negative). One pass over the chronologically-ordered list.
    // Doctrine OHADA (Acte uniforme art. 19, Tome 1 chap. 1) :
    //   - `runningBalance` reste signé (rétrocompat ancien front)
    //   - `runningBalanceAbs` + `runningBalanceSide` exposent la forme
    //     doctrine `Solde | D/C` attendue par le PDF / XLSX.
    const openingSignedNum = Number(opening.openingDebit) - Number(opening.openingCredit);
    let running = openingSignedNum;
    const lines: GeneralLedgerEntry[] = rawLines.map((row) => {
      running += Number(row.debit) - Number(row.credit);
      return {
        ...row,
        runningBalance: running.toFixed(2),
        runningBalanceAbs: Math.abs(running).toFixed(2),
        runningBalanceSide: running >= 0 ? 'D' : 'C',
      };
    });

    const periodDebit = rawLines.reduce((s, r) => s + Number(r.debit), 0);
    const periodCredit = rawLines.reduce((s, r) => s + Number(r.credit), 0);
    const totalDebit = Number(opening.openingDebit) + periodDebit;
    const totalCredit = Number(opening.openingCredit) + periodCredit;
    const net = totalDebit - totalCredit;

    const openingSide: LedgerBalanceSide = openingSignedNum >= 0 ? 'D' : 'C';
    const closingSide: LedgerBalanceSide = net >= 0 ? 'D' : 'C';

    return {
      accountId: account.id,
      accountCode: account.code,
      accountLabel: account.label,
      accountClass: account.class,
      fromDate: query.fromDate,
      toDate: query.toDate,
      opening: {
        ...opening,
        openingBalance: Math.abs(openingSignedNum).toFixed(2),
        openingBalanceSide: openingSide,
      },
      lines,
      totals: {
        periodDebit: periodDebit.toFixed(2),
        periodCredit: periodCredit.toFixed(2),
        endingDebit: (net > 0 ? net : 0).toFixed(2),
        endingCredit: (net < 0 ? -net : 0).toFixed(2),
        closingBalance: Math.abs(net).toFixed(2),
        closingBalanceSide: closingSide,
      },
    };
  }

  /**
   * Compte de Résultat OHADA — agrégation des classes 6 (charges) et 7
   * (produits) sur la période [fromDate, toDate].
   *
   * Chaque section (60, 61, …, 70, 71, …) liste les comptes mouvementés
   * sur la période avec leur contribution nette :
   *   - charges  : netDebit  = periodDebit  - periodCredit
   *   - produits : netCredit = periodCredit - periodDebit
   *
   * Résultat = Total Produits − Total Charges.
   */
  async getProfitLoss(
    organizationId: TenantId,
    query: {
      fromDate: string;
      toDate: string;
      compareWith?: { fromDate: string; toDate: string };
      /** Optional analytic axis filter (Migration 0092). */
      analyticAxisType?: string;
      analyticAxisCode?: string;
    },
  ): Promise<ProfitLossReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);
    if (query.compareWith !== undefined) {
      this.assertDateRange(query.compareWith.fromDate, query.compareWith.toDate);
    }

    const axis = {
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    };
    const current = await this.computeProfitLossBare(
      organizationId,
      query.fromDate,
      query.toDate,
      axis,
    );
    if (query.compareWith === undefined) {
      return current;
    }

    const previous = await this.computeProfitLossBare(
      organizationId,
      query.compareWith.fromDate,
      query.compareWith.toDate,
      axis,
    );
    return this.enrichProfitLossWithComparison(current, previous);
  }

  private async computeProfitLossBare(
    organizationId: TenantId,
    fromDate: string,
    toDate: string,
    axis: { analyticAxisType?: string; analyticAxisCode?: string } = {},
  ): Promise<ProfitLossReport> {
    const rows = await this.repo.trialBalance(organizationId, {
      fromDate,
      toDate,
      analyticAxisType: axis.analyticAxisType,
      analyticAxisCode: axis.analyticAxisCode,
    });
    const class6 = rows.filter((r) => r.accountClass === 6);
    const class7 = rows.filter((r) => r.accountClass === 7);

    const charges = PL_CHARGE_SECTIONS.map((section) =>
      this.buildPlSection(section.code, section.label, class6, 'CHARGE'),
    );
    const produits = PL_PRODUIT_SECTIONS.map((section) =>
      this.buildPlSection(section.code, section.label, class7, 'PRODUIT'),
    );

    const totalCharges = charges.reduce((s, sect) => s + Number(sect.amount), 0);
    const totalProduits = produits.reduce((s, sect) => s + Number(sect.amount), 0);
    const resultat = totalProduits - totalCharges;

    // Lignes doctrinales Tome 3 p. 33 (postes lettrés + SIG intercalés).
    const lines = ReportsService.buildProfitLossDoctrinalLines(rows);

    return {
      fromDate,
      toDate,
      charges,
      produits,
      lines,
      totalCharges: totalCharges.toFixed(2),
      totalProduits: totalProduits.toFixed(2),
      resultat: resultat.toFixed(2),
    };
  }

  /**
   * Construit la séquence ordonnée Tome 3 p. 33 — chaque entrée du
   * référentiel `PL_POSTES` devient une ligne avec son montant signé.
   *
   * Algorithme :
   *   1. Agrège chaque ligne de balance sur son poste lettré via
   *      `matchPoste` (préfixe le plus long gagne, ex. 6031 → RB).
   *   2. Pour chaque poste de flux, le montant signé est :
   *        - PRODUIT  : `+ (periodCredit − periodDebit)`
   *        - CHARGE   : `− (periodDebit − periodCredit)`
   *      Cette convention garantit que la somme algébrique des lignes
   *      d'une section donne le SIG associé.
   *   3. Les SIG XA..XI sont calculés en cascade à partir des montants
   *      déjà signés — pas de gestion de signe ad hoc.
   *
   * Les variations de stock (RB, RD, RF) suivent la convention OHADA :
   * un solde débiteur = déstockage (charge positive en valeur absolue,
   * donc négative en signé), un solde créditeur = stockage (contribue
   * positivement à la marge).
   */
  static buildProfitLossDoctrinalLines(
    rows: readonly TrialBalanceRow[],
  ): ReadonlyArray<ProfitLossDoctrinalLine> {
    // ── Étape 1 : agrégation par poste lettré (sans valeur absolue). ──
    const fluxByCode = new Map<string, number>();
    for (const row of rows) {
      const poste = matchPoste(row.accountCode);
      if (poste === null) continue;
      const periodD = Number(row.periodDebit);
      const periodC = Number(row.periodCredit);
      const signed =
        poste.side === 'PRODUIT'
          ? periodC - periodD // produits portent un signe positif
          : -(periodD - periodC); // charges signées négativement
      fluxByCode.set(poste.code, (fluxByCode.get(poste.code) ?? 0) + signed);
    }

    const get = (code: string): number => fluxByCode.get(code) ?? 0;

    // ── Étape 2 : cascade SIG (Tome 3 p. 33). ──
    // Les montants flux étant déjà signés (produits +, charges −), la
    // somme algébrique reproduit fidèlement la formule doctrinale.
    const XA = get('TA') + get('RA') + get('RB');
    const XB = get('TA') + get('TB') + get('TC') + get('TD');
    const XC =
      XB +
      get('RA') +
      get('RB') +
      get('TE') +
      get('TF') +
      get('TG') +
      get('TH') +
      get('TI') +
      get('RC') +
      get('RD') +
      get('RE') +
      get('RF') +
      get('RG') +
      get('RH') +
      get('RI') +
      get('RJ');
    const XD = XC + get('RK');
    const XE = XD + get('TJ') + get('RL');
    const XF = get('TK') + get('TL') + get('TM') + get('RM') + get('RN');
    const XG = XE + XF;
    const XH = get('TN') + get('TO') + get('RO') + get('RP');
    const XI = XG + XH + get('RQ') + get('RS');

    const sigValues: Readonly<Record<string, number>> = {
      XA,
      XB,
      XC,
      XD,
      XE,
      XF,
      XG,
      XH,
      XI,
    };

    // ── Étape 3 : projection sur la séquence éditoriale PL_POSTES. ──
    return PL_POSTES.map((poste): ProfitLossDoctrinalLine => {
      const amount = poste.kind === 'SIG' ? (sigValues[poste.code] ?? 0) : get(poste.code);
      return {
        ref: poste.code,
        label: poste.label,
        note: getPlNoteRef(poste.code),
        sign: getPlSignSymbol(poste.code),
        kind: poste.kind,
        amountN: amount.toFixed(2),
      };
    });
  }

  private enrichProfitLossWithComparison(
    current: ProfitLossReport,
    previous: ProfitLossReport,
  ): ProfitLossReport {
    const indexSection = (sects: readonly ProfitLossLine[]) =>
      new Map(sects.map((s) => [s.code, s]));
    const prevChargesIdx = indexSection(previous.charges);
    const prevProduitsIdx = indexSection(previous.produits);

    const enrichSection = (
      section: ProfitLossLine,
      prevIdx: Map<string, ProfitLossLine>,
    ): ProfitLossLine => {
      const prev = prevIdx.get(section.code);
      const prevAmount = prev ? Number(prev.amount) : 0;
      const cur = Number(section.amount);
      const variation = cur - prevAmount;
      const prevAccountsIdx = new Map((prev?.accounts ?? []).map((a) => [a.code, a]));
      const accounts = section.accounts.map((a): ProfitLossAccountLine => {
        const prevA = prevAccountsIdx.get(a.code);
        const prevAmt = prevA ? Number(prevA.amount) : 0;
        const curAmt = Number(a.amount);
        const va = curAmt - prevAmt;
        return {
          ...a,
          previousAmount: prevAmt.toFixed(2),
          variation: va.toFixed(2),
          variationPercent: ReportsService.percentChange(prevAmt, curAmt),
        };
      });
      return {
        ...section,
        previousAmount: prevAmount.toFixed(2),
        variation: variation.toFixed(2),
        variationPercent: ReportsService.percentChange(prevAmount, cur),
        accounts,
      };
    };

    // Enrichissement des lignes doctrinales (séquence Tome 3 p. 33).
    const prevLinesIdx = new Map(previous.lines.map((l) => [l.ref, l]));
    const enrichedLines = current.lines.map((line): ProfitLossDoctrinalLine => {
      const prev = prevLinesIdx.get(line.ref);
      return {
        ...line,
        amountPrevious: prev?.amountN ?? '0.00',
      };
    });

    return {
      ...current,
      charges: current.charges.map((s) => enrichSection(s, prevChargesIdx)),
      produits: current.produits.map((s) => enrichSection(s, prevProduitsIdx)),
      lines: enrichedLines,
      previous: {
        fromDate: previous.fromDate,
        toDate: previous.toDate,
        totalCharges: previous.totalCharges,
        totalProduits: previous.totalProduits,
        resultat: previous.resultat,
      },
    };
  }

  static percentChange(previous: number, current: number): string | null {
    if (Math.abs(previous) < 0.005) return null;
    return (((current - previous) / Math.abs(previous)) * 100).toFixed(2);
  }

  /**
   * Bilan OHADA — photographie patrimoniale "as at" une date.
   *
   * Classifie chaque compte ayant un solde cumulé en :
   *   ACTIF  : Immobilisé (cl. 2) / Circulant (cl. 3, 4 débit) / Trésorerie actif (cl. 5 débit)
   *   PASSIF : Capitaux propres (cl. 1, codes 10-15) / Dettes financières (cl. 1, codes 16+)
   *            / Passif circulant (cl. 4 crédit) / Trésorerie passif (cl. 5 crédit)
   *
   * Wave 2 n'incorpore PAS automatiquement le résultat de l'exercice
   * courant dans les capitaux propres — `difference` expose l'écart
   * actif − passif pour que l'utilisateur le contrôle visuellement.
   * Wave 3 fera la consolidation automatique.
   */
  async getBalanceSheet(
    organizationId: TenantId,
    query: {
      asAtDate: string;
      fiscalYearStartDate?: string;
      compareWith?: { asAtDate: string; fiscalYearStartDate?: string };
    },
  ): Promise<BalanceSheetReport> {
    assertTenantId(organizationId);
    if (!ReportsService.isYmd(query.asAtDate)) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: `asAtDate must be YYYY-MM-DD (got ${query.asAtDate}).`,
      });
    }
    if (query.fiscalYearStartDate !== undefined) {
      this.assertDateRange(query.fiscalYearStartDate, query.asAtDate);
    }
    if (query.compareWith !== undefined && !ReportsService.isYmd(query.compareWith.asAtDate)) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: `compareWith.asAtDate must be YYYY-MM-DD.`,
      });
    }

    const current = await this.computeBalanceSheetBare(
      organizationId,
      query.asAtDate,
      query.fiscalYearStartDate,
    );
    if (query.compareWith === undefined) {
      return current;
    }

    const previous = await this.computeBalanceSheetBare(
      organizationId,
      query.compareWith.asAtDate,
      query.compareWith.fiscalYearStartDate,
    );
    return this.enrichBalanceSheetWithComparison(current, previous);
  }

  /**
   * Génère Bilan + CR directement depuis une balance uploadée (lignes CSV),
   * sans passer par les écritures validées en base.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- public async contract; computes synchronously from the uploaded balance rows.
  async getReportsFromBalance(
    _organizationId: TenantId,
    input: {
      rows: ReadonlyArray<{ code: string; label: string; debit: string; credit: string }>;
      asAtDate: string;
      fiscalYearStartDate?: string;
    },
  ): Promise<{ bilan: BalanceSheetReport; cr: ProfitLossReport }> {
    const { rows, asAtDate, fiscalYearStartDate } = input;

    // ── 1. Convert uploaded rows to internal formats ────────────────
    const accountRows = rows.map((r) => ({
      accountId: r.code,
      accountCode: r.code,
      accountLabel: r.label,
      accountClass: Math.min(9, Math.max(1, parseInt(r.code[0] ?? '9') || 9)),
      totalDebit: r.debit || '0',
      totalCredit: r.credit || '0',
      isOpposing: /^(28|29|39|491|499|59)/.test(r.code),
    }));

    const trialRows: TrialBalanceRow[] = rows.map((r) => ({
      accountId: r.code,
      accountCode: r.code,
      accountLabel: r.label,
      accountClass: Math.min(9, Math.max(1, parseInt(r.code[0] ?? '9') || 9)),
      openingDebit: '0',
      openingCredit: '0',
      periodDebit: r.debit || '0',
      periodCredit: r.credit || '0',
      endingDebit: r.debit || '0',
      endingCredit: r.credit || '0',
    }));

    // ── 2. Compute P&L ──────────────────────────────────────────────
    const class6 = trialRows.filter((r) => r.accountClass === 6);
    const class7 = trialRows.filter((r) => r.accountClass === 7);

    const charges = PL_CHARGE_SECTIONS.map((s) =>
      this.buildPlSection(s.code, s.label, class6, 'CHARGE'),
    );
    const produits = PL_PRODUIT_SECTIONS.map((s) =>
      this.buildPlSection(s.code, s.label, class7, 'PRODUIT'),
    );

    const totalCharges = charges.reduce((s, sect) => s + Number(sect.amount), 0);
    const totalProduits = produits.reduce((s, sect) => s + Number(sect.amount), 0);
    const resultat = totalProduits - totalCharges;
    const lines = ReportsService.buildProfitLossDoctrinalLines(trialRows);

    const fromDate = fiscalYearStartDate ?? `${asAtDate.slice(0, 4)}-01-01`;

    const cr: ProfitLossReport = {
      fromDate,
      toDate: asAtDate,
      charges,
      produits,
      lines,
      totalCharges: totalCharges.toFixed(2),
      totalProduits: totalProduits.toFixed(2),
      resultat: resultat.toFixed(2),
    };

    // ── 3. Compute Balance Sheet ────────────────────────────────────
    const actifBuckets = new Map<BalanceSheetActifKey, BalanceSheetGroup[]>();
    const passifBuckets = new Map<BalanceSheetPassifKey, BalanceSheetGroup[]>();
    const opposingAccountIds = new Set<string>();

    for (const row of accountRows) {
      const debit = Number(row.totalDebit);
      const credit = Number(row.totalCredit);
      const net = debit - credit;
      if (Math.abs(net) < 0.005) continue;
      const netSign: 'D' | 'C' = net > 0 ? 'D' : 'C';
      const classification = classifyForBilan(
        row.accountCode,
        row.accountClass,
        netSign,
        row.isOpposing,
      );
      if (classification === null) continue;
      const group: BalanceSheetGroup = {
        accountId: row.accountId,
        code: row.accountCode,
        label: row.accountLabel,
        amount: Math.abs(net).toFixed(2),
      };
      if (classification.contraSign === -1) {
        opposingAccountIds.add(row.accountId);
      }
      if (classification.side === 'ACTIF') {
        const k = classification.key as BalanceSheetActifKey;
        const bucket = actifBuckets.get(k) ?? [];
        bucket.push(group);
        actifBuckets.set(k, bucket);
      } else {
        const k = classification.key as BalanceSheetPassifKey;
        const bucket = passifBuckets.get(k) ?? [];
        bucket.push(group);
        passifBuckets.set(k, bucket);
      }
    }

    let netResultIncorporated: string | null = null;
    if (fiscalYearStartDate !== undefined && Math.abs(resultat) >= 0.005) {
      netResultIncorporated = resultat.toFixed(2);
      const cpBucket = passifBuckets.get('CAPITAUX_PROPRES') ?? [];
      cpBucket.push({
        accountId: RESULTAT_GROUP_ID,
        code: resultat >= 0 ? '130' : '129',
        label:
          resultat >= 0 ? `Résultat de l'exercice (bénéfice)` : `Résultat de l'exercice (perte)`,
        amount: Math.abs(resultat).toFixed(2),
      });
      passifBuckets.set('CAPITAUX_PROPRES', cpBucket);
    }

    const actifSections: BalanceSheetSection[] = (
      Object.keys(ACTIF_SECTION_LABELS) as BalanceSheetActifKey[]
    ).map((key) => {
      const groups = actifBuckets.get(key) ?? [];
      const total = groups.reduce((s, g) => {
        const signed = opposingAccountIds.has(g.accountId) ? -Number(g.amount) : Number(g.amount);
        return s + signed;
      }, 0);
      return {
        key,
        label: ACTIF_SECTION_LABELS[key],
        groups,
        total: total.toFixed(2),
      };
    });

    const passifSections: BalanceSheetSection[] = (
      Object.keys(PASSIF_SECTION_LABELS) as BalanceSheetPassifKey[]
    ).map((key) => {
      const groups = passifBuckets.get(key) ?? [];
      const total = groups.reduce((s, g) => {
        const isLossMarker = g.accountId === RESULTAT_GROUP_ID && g.code === '129';
        const isOpposingAcc = opposingAccountIds.has(g.accountId);
        const signed = isLossMarker || isOpposingAcc ? -Number(g.amount) : Number(g.amount);
        return s + signed;
      }, 0);
      return {
        key,
        label: PASSIF_SECTION_LABELS[key],
        groups,
        total: total.toFixed(2),
      };
    });

    const totalActif = actifSections.reduce((s, sect) => s + Number(sect.total), 0);
    const totalPassif = passifSections.reduce((s, sect) => s + Number(sect.total), 0);

    const hierarchy = this.buildBilanHierarchy(accountRows, netResultIncorporated);

    const bilan: BalanceSheetReport = {
      asAtDate,
      actif: { sections: actifSections, total: totalActif.toFixed(2) },
      passif: { sections: passifSections, total: totalPassif.toFixed(2) },
      actifMasses: hierarchy.actifMasses,
      passifMasses: hierarchy.passifMasses,
      unclassified: hierarchy.unclassified,
      totals: {
        actif: hierarchy.totalActif,
        passif: hierarchy.totalPassif,
        difference: hierarchy.difference,
      },
      netResultIncorporated,
      difference: (totalActif - totalPassif).toFixed(2),
    };

    return { bilan, cr };
  }

  private async computeBalanceSheetBare(
    organizationId: TenantId,
    asAtDate: string,
    fiscalYearStartDate: string | undefined,
  ): Promise<BalanceSheetReport> {
    const rows = await this.repo.accountBalancesAsAt(organizationId, asAtDate);

    const actifBuckets = new Map<BalanceSheetActifKey, BalanceSheetGroup[]>();
    const passifBuckets = new Map<BalanceSheetPassifKey, BalanceSheetGroup[]>();

    // Le set des account-ids opposants (contraSign = -1) — réutilisé
    // plus bas par le réducteur de total de section pour soustraire
    // ces montants au lieu de les additionner.
    const opposingAccountIds = new Set<string>();

    for (const row of rows) {
      const debit = Number(row.totalDebit);
      const credit = Number(row.totalCredit);
      const net = debit - credit;
      if (Math.abs(net) < 0.005) continue;
      const netSign: 'D' | 'C' = net > 0 ? 'D' : 'C';
      const classification = classifyForBilan(
        row.accountCode,
        row.accountClass,
        netSign,
        row.isOpposing,
      );
      if (classification === null) continue;
      const group: BalanceSheetGroup = {
        accountId: row.accountId,
        code: row.accountCode,
        label: row.accountLabel,
        amount: Math.abs(net).toFixed(2),
      };
      if (classification.contraSign === -1) {
        opposingAccountIds.add(row.accountId);
      }
      if (classification.side === 'ACTIF') {
        const k = classification.key as BalanceSheetActifKey;
        const bucket = actifBuckets.get(k) ?? [];
        bucket.push(group);
        actifBuckets.set(k, bucket);
      } else {
        const k = classification.key as BalanceSheetPassifKey;
        const bucket = passifBuckets.get(k) ?? [];
        bucket.push(group);
        passifBuckets.set(k, bucket);
      }
    }

    // Auto-consolidate the fiscal-year net result into capitaux propres
    // when the caller provided the year-start anchor. Without this the
    // Bilan never balances by construction — wave 2 left it as a sanity
    // check on `difference`.
    let netResultIncorporated: string | null = null;
    if (fiscalYearStartDate !== undefined) {
      const pl = await this.computeProfitLossBare(organizationId, fiscalYearStartDate, asAtDate);
      const netResult = Number(pl.resultat);
      if (Math.abs(netResult) >= 0.005) {
        netResultIncorporated = netResult.toFixed(2);
        const cpBucket = passifBuckets.get('CAPITAUX_PROPRES') ?? [];
        // A loss reduces capitaux propres → push a negative entry.
        // SYSCOHADA presents the result on the credit side of class 13
        // (Résultat net), so we keep the absolute amount but flag the
        // sign through `code`: "130" for gain, "129" for loss (the
        // OHADA reform calls 12 "Résultat en instance d'affectation").
        cpBucket.push({
          accountId: RESULTAT_GROUP_ID,
          code: netResult >= 0 ? '130' : '129',
          label:
            netResult >= 0 ? `Résultat de l'exercice (bénéfice)` : `Résultat de l'exercice (perte)`,
          // Stored as absolute positive value so the section-total
          // reducer below can apply the sign through the code marker
          // ('129' subtracts, '130' adds). `netResultIncorporated` at
          // the report root keeps the signed value for the header.
          amount: Math.abs(netResult).toFixed(2),
        });
        passifBuckets.set('CAPITAUX_PROPRES', cpBucket);
      }
    }

    const actifSections: BalanceSheetSection[] = (
      Object.keys(ACTIF_SECTION_LABELS) as BalanceSheetActifKey[]
    ).map((key) => {
      const groups = actifBuckets.get(key) ?? [];
      // Comptes opposants (29x/39x/49x/59x, 109, 121, 129, 409) :
      // leur montant absolu vient EN DÉDUCTION du total de section.
      const total = groups.reduce((s, g) => {
        const signed = opposingAccountIds.has(g.accountId) ? -Number(g.amount) : Number(g.amount);
        return s + signed;
      }, 0);
      return {
        key,
        label: ACTIF_SECTION_LABELS[key],
        groups,
        total: total.toFixed(2),
      };
    });

    const passifSections: BalanceSheetSection[] = (
      Object.keys(PASSIF_SECTION_LABELS) as BalanceSheetPassifKey[]
    ).map((key) => {
      const groups = passifBuckets.get(key) ?? [];
      // For Capitaux propres specifically, the net-result line carries
      // a signed amount embedded in a positive `amount` string +
      // negative-flagged code. We compute the sectional total with the
      // sign reapplied so a loss shrinks capitaux propres correctly.
      // Comptes opposants (109, 121, 129 par ex.) sont également
      // soustraits.
      const total = groups.reduce((s, g) => {
        const isLossMarker = g.accountId === RESULTAT_GROUP_ID && g.code === '129';
        const isOpposingAcc = opposingAccountIds.has(g.accountId);
        const signed = isLossMarker || isOpposingAcc ? -Number(g.amount) : Number(g.amount);
        return s + signed;
      }, 0);
      return {
        key,
        label: PASSIF_SECTION_LABELS[key],
        groups,
        total: total.toFixed(2),
      };
    });

    const totalActif = actifSections.reduce((s, sect) => s + Number(sect.total), 0);
    const totalPassif = passifSections.reduce((s, sect) => s + Number(sect.total), 0);

    // ── W2.1 — Construction de la hiérarchie 35 postes lettrés ──────
    const hierarchy = this.buildBilanHierarchy(rows, netResultIncorporated);

    return {
      asAtDate,
      actif: { sections: actifSections, total: totalActif.toFixed(2) },
      passif: { sections: passifSections, total: totalPassif.toFixed(2) },
      actifMasses: hierarchy.actifMasses,
      passifMasses: hierarchy.passifMasses,
      unclassified: hierarchy.unclassified,
      totals: {
        actif: hierarchy.totalActif,
        passif: hierarchy.totalPassif,
        difference: hierarchy.difference,
      },
      netResultIncorporated,
      difference: (totalActif - totalPassif).toFixed(2),
    };
  }

  /**
   * W2.1 — Agrégation des soldes par poste lettré officiel SYSCOHADA
   * AUDCIF (35 postes AD-BZ pour l'actif, CA-DZ pour le passif).
   *
   * Algo :
   *  1. Pour chaque ligne de solde, identifier le poste lettré via
   *     `classifyToPoste` (prefix-longest-match sur le référentiel).
   *  2. Accumuler `brut` (contribution standard) / `deduction`
   *     (amortissements, dépréciations, opposants).
   *  3. Sommer les postes par RUBRIQUE (champ `section` du référentiel).
   *  4. Sommer les rubriques par MASSE via le chaînage `parentGroup`
   *     (les masses sont les postes `section === '_TOTAL_'`).
   *  5. Si le P&L a été incorporé (netResultIncorporated non null), le
   *     mécanisme legacy a déjà ajouté la ligne au bucket CAPITAUX_PROPRES :
   *     on l'incorpore ici dans le poste CJ « Résultat net de
   *     l'exercice » pour la même cohérence.
   */
  private buildBilanHierarchy(
    rows: ReadonlyArray<{
      readonly accountId: string;
      readonly accountCode: string;
      readonly accountLabel: string;
      readonly accountClass: number;
      readonly isOpposing: boolean;
      readonly totalDebit: string;
      readonly totalCredit: string;
    }>,
    netResultIncorporated: string | null,
  ): {
    actifMasses: ReadonlyArray<BilanMasse>;
    passifMasses: ReadonlyArray<BilanMasse>;
    unclassified: ReadonlyArray<BilanPoste>;
    totalActif: string;
    totalPassif: string;
    difference: string;
  } {
    type PosteAcc = { brut: number; deduction: number };
    const posteAccs = new Map<string, PosteAcc>(); // posteCode → acc
    const unclassifiedRows: BilanPoste[] = [];

    const addToPoste = (posteCode: string, asDeduction: boolean, amount: number): void => {
      const acc = posteAccs.get(posteCode) ?? { brut: 0, deduction: 0 };
      if (asDeduction) acc.deduction += amount;
      else acc.brut += amount;
      posteAccs.set(posteCode, acc);
    };

    for (const row of rows) {
      const debit = Number(row.totalDebit);
      const credit = Number(row.totalCredit);
      const net = debit - credit;
      if (Math.abs(net) < 0.005) continue;

      // Le signe du solde tranche les comptes de tiers à double appartenance
      // (462/463/471… présents en poste actif ET passif).
      const classification = classifyToPoste(row.accountCode, row.isOpposing, net >= 0 ? 'D' : 'C');
      if (classification === null) {
        // Bilan-relevant class (1-5) mais aucun préfixe matché → bucket
        // dédié pour visibilité. Les classes 6-9 retournent aussi null
        // mais on les ignore (elles vont au P&L).
        if (row.accountClass >= 1 && row.accountClass <= 5) {
          unclassifiedRows.push({
            code: row.accountCode,
            label: row.accountLabel,
            side: row.accountClass === 1 ? 'PASSIF' : 'ACTIF',
            net: net.toFixed(2),
          });
        }
        continue;
      }
      // Convention : on stocke le montant en valeur absolue ; le côté
      // (actif/passif) est déjà encodé par le poste cible. Pour un
      // compte de classe 4 à solde créditeur classifié dans un poste
      // ACTIF (cas opposant ou avance), `asDeduction` fait le travail.
      addToPoste(classification.posteCode, classification.asDeduction, Math.abs(net));
    }

    // Incorporation du résultat net (réutilise la valeur déjà calculée
    // par le bloc legacy) dans le poste lettré CJ « Résultat net ».
    if (netResultIncorporated !== null) {
      const net = Number(netResultIncorporated);
      if (Math.abs(net) >= 0.005) {
        // Bénéfice → contribution standard ; perte → déduction (signe -).
        addToPoste('CJ', net < 0, Math.abs(net));
      }
    }

    // Index posteCode → BilanPosteRef pour résolution rapide.
    const posteByCode = new Map<string, BilanPosteRef>();
    for (const p of BILAN_POSTES) posteByCode.set(p.code, p);

    // Construction des postes-feuilles (avec leur net signé).
    // On itère sur TOUS les postes du référentiel (hors sous-totaux)
    // pour garantir la présence de toutes les lignes exigées par le modèle
    // (doctrine SYSCOHADA), même si leur solde est nul.
    const builtPostes = new Map<string, BilanPoste>();
    for (const ref of BILAN_POSTES) {
      if (ref.section === '_TOTAL_') continue;

      const acc = posteAccs.get(ref.code) ?? { brut: 0, deduction: 0 };
      const net = (acc.brut - acc.deduction) * ref.sign;

      const poste: BilanPoste = {
        code: ref.code,
        label: ref.label,
        ...(ref.note !== undefined ? { note: ref.note } : {}),
        side: ref.side,
        net: net.toFixed(2),
        brut: acc.brut > 0 ? acc.brut.toFixed(2) : undefined,
        deduction: acc.deduction > 0 ? acc.deduction.toFixed(2) : undefined,
      };
      builtPostes.set(ref.code, poste);
    }

    // Calcul des sous-totaux pour chaque masse `_TOTAL_` via parentGroup.
    // Algorithme : pour chaque poste-feuille, on remonte `parentGroup`
    // jusqu'à la masse racine et on accumule son `net` dans toutes les
    // masses intermédiaires.
    const masseTotals = new Map<string, number>();
    for (const poste of builtPostes.values()) {
      let cursor: string | undefined = posteByCode.get(poste.code)?.parentGroup;
      const seen = new Set<string>();
      while (cursor !== undefined && !seen.has(cursor)) {
        seen.add(cursor);
        const ref = posteByCode.get(cursor);
        if (!ref) break;
        if (ref.section === '_TOTAL_') {
          masseTotals.set(cursor, (masseTotals.get(cursor) ?? 0) + Number(poste.net));
        }
        cursor = ref.parentGroup;
      }
    }

    // Regroupement par RUBRIQUE (postes-feuilles ayant le même
    // `section` éditorial, hors `_TOTAL_`). Puis rattachement de
    // chaque rubrique à la masse qui contient ses postes (via le
    // premier ancêtre _TOTAL_ rencontré). On préserve l'ordre du
    // référentiel.
    type RubriqueAcc = { label: string; postes: BilanPoste[]; masseCode: string };
    const rubriquesByKey = new Map<string, RubriqueAcc>(); // key = `${masseCode}::${section}`

    for (const ref of BILAN_POSTES) {
      if (ref.section === '_TOTAL_') continue;
      const built = builtPostes.get(ref.code);
      if (!built) continue;
      // Trouve la masse parente directe (premier ancêtre _TOTAL_).
      let cursor: string | undefined = ref.parentGroup;
      let masseCode = '';
      const seen = new Set<string>();
      while (cursor !== undefined && !seen.has(cursor)) {
        seen.add(cursor);
        const r = posteByCode.get(cursor);
        if (r?.section === '_TOTAL_') {
          masseCode = cursor;
          break;
        }
        cursor = r?.parentGroup;
      }
      if (!masseCode) continue; // poste orphelin — skip défensif
      const key = `${masseCode}::${ref.section}`;
      const existing = rubriquesByKey.get(key);
      if (existing) existing.postes.push(built);
      else rubriquesByKey.set(key, { label: ref.section, postes: [built], masseCode });
    }

    // Construction finale des masses, dans l'ordre du référentiel.
    const buildMasses = (side: 'ACTIF' | 'PASSIF'): BilanMasse[] => {
      const masseRefs = BILAN_POSTES.filter((p) => p.section === '_TOTAL_' && p.side === side);
      return masseRefs.map((ref) => {
        const rubs: BilanRubrique[] = [];
        for (const [key, rub] of rubriquesByKey) {
          if (rub.masseCode !== ref.code) continue;
          // Tri des postes par code lettré (AE < AF < AG…).
          const sortedPostes = [...rub.postes].sort((a, b) => a.code.localeCompare(b.code));
          const subtotal = sortedPostes.reduce((s, p) => s + Number(p.net), 0);
          rubs.push({ label: rub.label, postes: sortedPostes, subtotal: subtotal.toFixed(2) });
          // Suppression du marquer 'key' inutilisé (lint).
          void key;
        }
        const total = masseTotals.get(ref.code) ?? 0;
        return {
          code: ref.code,
          label: ref.label,
          rubriques: rubs,
          total: total.toFixed(2),
        };
      });
      // On expose toutes les masses du référentiel (y compris les masses
      // racine BZ/DZ et les masses parents BK/DF qui n'ont pas de
      // rubriques propres mais dont le total agrège leurs enfants).
    };

    const actifMasses = buildMasses('ACTIF');
    const passifMasses = buildMasses('PASSIF');

    const totalActif = masseTotals.get('BZ') ?? 0;
    const totalPassif = masseTotals.get('DZ') ?? 0;

    return {
      actifMasses,
      passifMasses,
      unclassified: unclassifiedRows,
      totalActif: totalActif.toFixed(2),
      totalPassif: totalPassif.toFixed(2),
      difference: (totalActif - totalPassif).toFixed(2),
    };
  }

  private enrichBalanceSheetWithComparison(
    current: BalanceSheetReport,
    previous: BalanceSheetReport,
  ): BalanceSheetReport {
    const indexBy = (sections: readonly BalanceSheetSection[]) =>
      new Map(sections.map((s) => [s.key, s]));
    const prevActifIdx = indexBy(previous.actif.sections);
    const prevPassifIdx = indexBy(previous.passif.sections);

    const enrichSection = (
      section: BalanceSheetSection,
      prevIdx: Map<string, BalanceSheetSection>,
    ): BalanceSheetSection => {
      const prev = prevIdx.get(section.key);
      const prevGroupsIdx = new Map((prev?.groups ?? []).map((g) => [g.code, g]));
      return {
        ...section,
        previousTotal: prev ? prev.total : '0.00',
        groups: section.groups.map((g) => {
          const pg = prevGroupsIdx.get(g.code);
          const prevAmount = pg ? Number(pg.amount) : 0;
          const curAmount = Number(g.amount);
          return {
            ...g,
            previousAmount: prevAmount.toFixed(2),
            variation: (curAmount - prevAmount).toFixed(2),
            variationPercent: ReportsService.percentChange(prevAmount, curAmount),
          };
        }),
      };
    };

    // W2.1 — Enrichir la hiérarchie postes lettrés avec les valeurs N-1.
    const enrichMasses = (
      current35: ReadonlyArray<BilanMasse>,
      previous35: ReadonlyArray<BilanMasse>,
    ): ReadonlyArray<BilanMasse> => {
      const prevMasseIdx = new Map(previous35.map((m) => [m.code, m]));
      return current35.map((m) => {
        const prevM = prevMasseIdx.get(m.code);
        const prevRubIdx = new Map((prevM?.rubriques ?? []).map((r) => [r.label, r]));
        return {
          ...m,
          totalPrevious: prevM ? prevM.total : '0.00',
          rubriques: m.rubriques.map((r) => {
            const prevR = prevRubIdx.get(r.label);
            const prevPosteIdx = new Map((prevR?.postes ?? []).map((p) => [p.code, p]));
            return {
              ...r,
              subtotalPrevious: prevR ? prevR.subtotal : '0.00',
              postes: r.postes.map((p) => {
                const prevP = prevPosteIdx.get(p.code);
                const prevNet = prevP ? Number(prevP.net) : 0;
                const curNet = Number(p.net);
                return {
                  ...p,
                  netPrevious: prevNet.toFixed(2),
                  netChange: (curNet - prevNet).toFixed(2),
                };
              }),
            };
          }),
        };
      });
    };

    return {
      ...current,
      actif: {
        ...current.actif,
        sections: current.actif.sections.map((s) => enrichSection(s, prevActifIdx)),
      },
      passif: {
        ...current.passif,
        sections: current.passif.sections.map((s) => enrichSection(s, prevPassifIdx)),
      },
      actifMasses: enrichMasses(current.actifMasses, previous.actifMasses),
      passifMasses: enrichMasses(current.passifMasses, previous.passifMasses),
      previous: {
        asAtDate: previous.asAtDate,
        totalActif: previous.actif.total,
        totalPassif: previous.passif.total,
        difference: previous.difference,
      },
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private buildPlSection(
    prefix: string,
    label: string,
    rows: readonly TrialBalanceRow[],
    side: 'CHARGE' | 'PRODUIT',
  ): ProfitLossLine {
    const matching = rows.filter((r) => r.accountCode.startsWith(prefix));
    const accounts = matching
      .map((r) => {
        const periodD = Number(r.periodDebit);
        const periodC = Number(r.periodCredit);
        const net = side === 'CHARGE' ? periodD - periodC : periodC - periodD;
        return { code: r.accountCode, label: r.accountLabel, amount: net };
      })
      .filter((a) => Math.abs(a.amount) >= 0.005);

    const amount = accounts.reduce((s, a) => s + a.amount, 0);
    return {
      code: prefix,
      label,
      amount: amount.toFixed(2),
      accounts: accounts.map((a) => ({
        code: a.code,
        label: a.label,
        amount: a.amount.toFixed(2),
      })),
    };
  }

  /**
   * Validité de la période AVANT génération (AC-V5). Permet au Report Console
   * d'annoncer, dès le choix de la période, si l'état sera fiable : nombre
   * d'écritures committées, équilibre du journal (Σdébit−Σcrédit), date du
   * dernier mouvement. Volontairement léger (un seul agrégat) pour rester
   * appelable à chaque changement de période.
   */
  async getPeriodValidity(
    organizationId: TenantId,
    query: { readonly fromDate: string; readonly toDate: string },
  ): Promise<PeriodValidityReport> {
    this.assertDateRange(query.fromDate, query.toDate);

    const agg = await this.repo.periodValidity(organizationId, {
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
    const rawImbalance = Math.abs(Number(agg.totalDebit) - Number(agg.totalCredit));
    return {
      committedEntries: agg.committedEntries,
      imbalance: rawImbalance < 1 ? 0 : Math.round(rawImbalance),
      lastMovementDate: agg.lastMovementDate,
      computedAt: new Date().toISOString(),
      periodClosed: false,
    };
  }

  private assertDateRange(fromDate: string, toDate: string): void {
    if (!ReportsService.isYmd(fromDate) || !ReportsService.isYmd(toDate)) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: `Both fromDate and toDate must be YYYY-MM-DD (got ${fromDate}, ${toDate}).`,
      });
    }
    if (fromDate > toDate) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: `fromDate must be <= toDate (got ${fromDate} > ${toDate}).`,
      });
    }
  }

  static isYmd(s: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  private computeTrialBalanceTotals(rows: readonly TrialBalanceRow[]): {
    openingDebit: string;
    openingCredit: string;
    periodDebit: string;
    periodCredit: string;
    endingDebit: string;
    endingCredit: string;
  } {
    const sum = (key: keyof TrialBalanceRow): number =>
      rows.reduce((s, r) => s + Number(r[key] as string), 0);
    return {
      openingDebit: sum('openingDebit').toFixed(2),
      openingCredit: sum('openingCredit').toFixed(2),
      periodDebit: sum('periodDebit').toFixed(2),
      periodCredit: sum('periodCredit').toFixed(2),
      endingDebit: sum('endingDebit').toFixed(2),
      endingCredit: sum('endingCredit').toFixed(2),
    };
  }

  // ─── Import diagnostic ───────────────────────────────────────────────

  /**
   * Diagnostic d'import — produit un rapport complet sur l'état de
   * santé d'une session avant son commit. Lit `import_staging_entries`
   * (PAS les journaux validés). Voir `ImportDiagnosticReport` pour la
   * forme retournée.
   *
   * Cas d'erreur : session inexistante ou hors tenant →
   * `IMPORT_SESSION_NOT_FOUND`. Une session en `draft` retourne un
   * rapport vide (totaux à 0, pas d'anomalies) — c'est volontaire pour
   * que l'UI puisse afficher le diagnostic dès que la session existe.
   */
  async getImportDiagnostic(
    organizationId: TenantId,
    sessionId: string,
  ): Promise<ImportDiagnosticReport> {
    const session = await this.repo.fetchImportSessionMeta(organizationId, sessionId);
    if (session === null) {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_FOUND);
    }

    const rows = await this.repo.fetchImportStagingRows(organizationId, sessionId);

    // 1. Agrégation balance par compte ----------------------------------
    interface AccountAggregate {
      debit: number;
      credit: number;
      lineCount: number;
      autoProvisionable: boolean;
    }
    const aggregates = new Map<string, AccountAggregate>();
    for (const row of rows) {
      const code = (row.mappedValues.account ?? '').trim();
      if (code === '') continue;
      const debit = Number(row.mappedValues.debit ?? '0') || 0;
      const credit = Number(row.mappedValues.credit ?? '0') || 0;
      const agg = aggregates.get(code) ?? {
        debit: 0,
        credit: 0,
        lineCount: 0,
        autoProvisionable: false,
      };
      agg.debit += debit;
      agg.credit += credit;
      agg.lineCount += 1;
      if (row.errors.some((e) => e.code === 'unknown_account_with_parent_hint')) {
        agg.autoProvisionable = true;
      }
      aggregates.set(code, agg);
    }

    // 2. Labels comptes (1 requête pour toute la balance) ---------------
    const accountCodes = Array.from(aggregates.keys());
    const labels = await this.repo.fetchAccountLabelsByCode(organizationId, accountCodes);

    // 3. Lignes balance triées par code --------------------------------
    const trialBalance: ImportTrialBalanceRow[] = accountCodes
      .map((code) => {
        const agg = aggregates.get(code) as AccountAggregate;
        const accountExists = labels.has(code);
        const accountLabel = labels.get(code) ?? '(compte inconnu)';
        const net = agg.debit - agg.credit;
        const sign: 'D' | 'C' | '=' = Math.abs(net) < 0.005 ? '=' : net > 0 ? 'D' : 'C';
        return {
          accountCode: code,
          accountLabel,
          debit: agg.debit.toFixed(2),
          credit: agg.credit.toFixed(2),
          balance: Math.abs(net).toFixed(2),
          sign,
          lineCount: agg.lineCount,
          accountExists,
          autoProvisionable: !accountExists && agg.autoProvisionable,
        } satisfies ImportTrialBalanceRow;
      })
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    // 4. Totaux + équilibre ---------------------------------------------
    let totalDebit = 0;
    let totalCredit = 0;
    for (const r of trialBalance) {
      totalDebit += Number(r.debit);
      totalCredit += Number(r.credit);
    }
    const balanceDelta = totalDebit - totalCredit;
    const isBalanced = Math.abs(balanceDelta) < 0.01;

    // 5. Groupement des anomalies par code -----------------------------
    interface AnomalyAccumulator {
      readonly code: string;
      count: number;
      samples: ImportAnomalySample[];
    }
    const errorGroups = new Map<string, AnomalyAccumulator>();
    for (const row of rows) {
      for (const err of row.errors) {
        const acc = errorGroups.get(err.code) ?? {
          code: err.code,
          count: 0,
          samples: [],
        };
        acc.count += 1;
        if (acc.samples.length < 5) {
          const accountCode = (row.mappedValues.account ?? '').trim() || null;
          acc.samples.push({
            rowNumber: row.rowNumber,
            accountCode,
            ...(err.field !== undefined ? { field: err.field } : {}),
            message: err.message,
          });
        }
        errorGroups.set(err.code, acc);
      }
    }

    // 6. Classement par sévérité ----------------------------------------
    const critical: ImportAnomalyGroup[] = [];
    const warnings: ImportAnomalyGroup[] = [];
    const info: ImportAnomalyGroup[] = [];
    for (const acc of errorGroups.values()) {
      const meta = ANOMALY_META[acc.code] ?? {
        severity: 'info' as ImportAnomalySeverity,
        title: acc.code,
        description: 'Anomalie non catégorisée.',
        remediation: 'Examiner les lignes concernées.',
        autoFixable: false,
      };
      const group: ImportAnomalyGroup = {
        code: acc.code,
        severity: meta.severity,
        title: meta.title,
        description: meta.description,
        count: acc.count,
        samples: acc.samples,
      };
      if (meta.severity === 'critical') critical.push(group);
      else if (meta.severity === 'warning') warnings.push(group);
      else info.push(group);
    }

    // Anomalie systémique : déséquilibre global ------------------------
    if (!isBalanced && trialBalance.length > 0) {
      critical.unshift({
        code: 'unbalanced_total',
        severity: 'critical',
        title: 'Déséquilibre global ∑D ≠ ∑C',
        description: `La somme des débits (${totalDebit.toFixed(2)}) ne correspond pas à la somme des crédits (${totalCredit.toFixed(2)}). Écart : ${Math.abs(balanceDelta).toFixed(2)} ${balanceDelta > 0 ? '(excédent débit)' : '(excédent crédit)'}.`,
        count: 1,
        samples: [],
      });
    }

    // Tri intra-sévérité par count décroissant -------------------------
    const byCountDesc = (a: ImportAnomalyGroup, b: ImportAnomalyGroup) => b.count - a.count;
    critical.sort(byCountDesc);
    warnings.sort(byCountDesc);
    info.sort(byCountDesc);

    // 7. Plan de remédiation --------------------------------------------
    const remediationPlan: ImportRemediationItem[] = [];
    for (const group of [...critical, ...warnings, ...info]) {
      const meta = ANOMALY_META[group.code];
      if (group.code === 'unbalanced_total') {
        remediationPlan.push({
          priority: 1,
          title: 'Rééquilibrer le fichier',
          description: `Identifier la ou les écritures manquantes pour annuler l'écart de ${Math.abs(balanceDelta).toFixed(2)}. Vérifier d'abord les groupes de lignes (journal, date) pour localiser l'écriture incomplète.`,
          autoFixable: false,
          affectedCount: 1,
        });
        continue;
      }
      if (meta === undefined) continue;
      const priority: 1 | 2 | 3 =
        meta.severity === 'critical' ? 1 : meta.severity === 'warning' ? 2 : 3;
      remediationPlan.push({
        priority,
        title: meta.title,
        description: meta.remediation,
        autoFixable: meta.autoFixable,
        affectedCount: group.count,
      });
    }
    remediationPlan.sort((a, b) => a.priority - b.priority);

    // 8. Verdict --------------------------------------------------------
    const criticalCount = critical.length;
    const warningCount = warnings.length;
    const infoCount = info.length;
    const status: 'conforme' | 'à corriger' | 'bloquant' =
      criticalCount > 0 ? 'bloquant' : warningCount > 0 ? 'à corriger' : 'conforme';
    const canCommit = criticalCount === 0;

    return {
      session: {
        id: session.id,
        label: session.label,
        status: session.status,
        sourceType: session.sourceType,
        documentType: session.documentType,
        totalLines: session.totalLines,
        errorLines: session.errorLines,
        createdAt: session.createdAt.toISOString(),
      },
      trialBalance,
      totals: {
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        balanceDelta: balanceDelta.toFixed(2),
        isBalanced,
      },
      anomalies: { critical, warnings, info },
      remediationPlan,
      verdict: {
        status,
        criticalCount,
        warningCount,
        infoCount,
        canCommit,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Bilan Diagnostic
  // ---------------------------------------------------------------------------

  async getBilanDiagnostic(
    organizationId: TenantId,
    query: { asAtDate: string; fiscalYearStartDate?: string },
  ): Promise<BilanDiagnosticReport> {
    assertTenantId(organizationId);
    if (!ReportsService.isYmd(query.asAtDate)) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: `asAtDate must be YYYY-MM-DD (got ${query.asAtDate}).`,
      });
    }

    const rows = await this.repo.accountBalancesAsAt(organizationId, query.asAtDate);

    // 1. Journal balance check — Σ(débit) vs Σ(crédit) sur toutes les classes
    let grandTotalDebit = 0;
    let grandTotalCredit = 0;
    for (const row of rows) {
      grandTotalDebit += Number(row.totalDebit);
      grandTotalCredit += Number(row.totalCredit);
    }
    const imbalance = grandTotalDebit - grandTotalCredit;

    // 2. By-class breakdown
    const CLASS_META: Record<number, { label: string; role: BilanDiagnosticClassRole }> = {
      1: {
        label: 'Ressources durables (capitaux propres, dettes financières)',
        role: 'BILAN_PASSIF',
      },
      2: { label: 'Immobilisations', role: 'BILAN_ACTIF' },
      3: { label: 'Stocks', role: 'BILAN_ACTIF' },
      4: { label: 'Comptes de tiers (actif et passif)', role: 'BILAN_ACTIF' },
      5: { label: 'Trésorerie', role: 'BILAN_ACTIF' },
      6: { label: 'Charges par nature', role: 'PL_CHARGES' },
      7: { label: 'Produits par nature', role: 'PL_PRODUITS' },
      8: { label: 'Autres charges et produits', role: 'PL_CHARGES' },
      9: { label: 'Comptabilité analytique', role: 'AUTRES' },
    };

    const classMap = new Map<number, { debit: number; credit: number; count: number }>();
    for (const row of rows) {
      const cls = row.accountClass;
      const acc = classMap.get(cls) ?? { debit: 0, credit: 0, count: 0 };
      acc.debit += Number(row.totalDebit);
      acc.credit += Number(row.totalCredit);
      acc.count += 1;
      classMap.set(cls, acc);
    }
    const byClass = Array.from(classMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([cls, acc]) => {
        const meta = CLASS_META[cls] ?? {
          label: `Classe ${cls}`,
          role: 'AUTRES' as BilanDiagnosticClassRole,
        };
        return {
          class: cls,
          label: meta.label,
          role: meta.role,
          totalDebit: acc.debit.toFixed(2),
          totalCredit: acc.credit.toFixed(2),
          net: (acc.debit - acc.credit).toFixed(2),
          accountCount: acc.count,
        };
      });

    // 3. Bilan hierarchy (réutilise computeBalanceSheetBare pour la cohérence)
    const bilanReport = await this.computeBalanceSheetBare(
      organizationId,
      query.asAtDate,
      query.fiscalYearStartDate,
    );

    // 4. Réconciliation avec convention de signe passif
    // Les comptes passif hors-référentiel ont net = débit - crédit (négatif pour un passif normal).
    // On inverse le signe pour que le montant passif ajusté s'additionne positivement.
    const unclActif = bilanReport.unclassified.filter((p) => p.side !== 'PASSIF');
    const unclPassif = bilanReport.unclassified.filter((p) => p.side === 'PASSIF');
    const actifUnclassifiedNet = unclActif.reduce((s, p) => s + Number(p.net), 0);
    const passifUnclassifiedNet = unclPassif.reduce((s, p) => s + -Number(p.net), 0);
    const adjActif = Number(bilanReport.totals.actif) + actifUnclassifiedNet;
    const adjPassif = Number(bilanReport.totals.passif) + passifUnclassifiedNet;
    const adjDifference = adjActif - adjPassif;

    // 5. Checklist travaux de fin d'exercice
    const matchesPrefix = (code: string, prefixes: string[]): boolean =>
      prefixes.some((p) => code.startsWith(p));

    const yearEndCheck = (prefixes: string[]): { present: boolean; totalAmount: string } => {
      let total = 0;
      let count = 0;
      for (const row of rows) {
        if (matchesPrefix(row.accountCode, prefixes)) {
          const net = Math.abs(Number(row.totalDebit) - Number(row.totalCredit));
          if (net >= 0.005) {
            total += net;
            count += 1;
          }
        }
      }
      return { present: count > 0, totalAmount: total.toFixed(2) };
    };

    const amortPrefixes = ['281', '282', '283', '284', '285', '286', '287', '288', '289'];
    let amortTotal = 0;
    const amortAccounts: Array<{ code: string; label: string; amount: string }> = [];
    for (const row of rows) {
      if (matchesPrefix(row.accountCode, amortPrefixes)) {
        const net = Math.abs(Number(row.totalDebit) - Number(row.totalCredit));
        if (net >= 0.005) {
          amortTotal += net;
          amortAccounts.push({
            code: row.accountCode,
            label: row.accountLabel,
            amount: net.toFixed(2),
          });
        }
      }
    }

    // Enrichir les hors-référentiel avec totalDebit/totalCredit depuis les soldes bruts
    const rowByCode = new Map(rows.map((r) => [r.accountCode, r]));
    const unclassifiedEnriched = bilanReport.unclassified.map((p) => {
      const row = rowByCode.get(p.code);
      return {
        code: p.code,
        label: p.label,
        totalDebit: row?.totalDebit ?? '0.00',
        totalCredit: row?.totalCredit ?? '0.00',
        net: p.net,
        side: p.side,
      };
    });

    return {
      asAtDate: query.asAtDate,
      journal: {
        totalDebit: grandTotalDebit.toFixed(2),
        totalCredit: grandTotalCredit.toFixed(2),
        imbalance: imbalance.toFixed(2),
        isBalanced: Math.abs(imbalance) < 1,
      },
      byClass,
      bilan: {
        actifClassified: bilanReport.totals.actif,
        passifClassified: bilanReport.totals.passif,
        actifUnclassified: actifUnclassifiedNet.toFixed(2),
        passifUnclassified: passifUnclassifiedNet.toFixed(2),
        netResultIncorporated: bilanReport.netResultIncorporated,
        adjActif: adjActif.toFixed(2),
        adjPassif: adjPassif.toFixed(2),
        adjDifference: adjDifference.toFixed(2),
        isEquilibrated: Math.abs(adjDifference) < 1,
      },
      unclassified: unclassifiedEnriched,
      yearEnd: {
        amortissements: {
          present: amortAccounts.length > 0,
          totalAmount: amortTotal.toFixed(2),
          accounts: amortAccounts,
        },
        depreciations: yearEndCheck(['29', '39', '49', '59']),
        chargesConstateesAvance: yearEndCheck(['476']),
        produitsConstatesAvance: yearEndCheck(['477']),
        chargesAPayer: yearEndCheck(['408']),
        produitsARecevoir: yearEndCheck(['418']),
        provisionImpots: yearEndCheck(['444']),
        variationStocks: yearEndCheck([
          '603',
          '604',
          '605',
          '731',
          '732',
          '733',
          '734',
          '735',
          '736',
          '737',
          '738',
          '739',
        ]),
      },
    };
  }
}
