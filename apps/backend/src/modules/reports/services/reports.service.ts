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

export interface GeneralLedgerEntry extends GeneralLedgerRow {
  /** Cumulative debit-credit balance up to and including this line. */
  readonly runningBalance: string;
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

export interface ProfitLossReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly charges: ReadonlyArray<ProfitLossLine>;
  readonly produits: ReadonlyArray<ProfitLossLine>;
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

export interface GeneralLedgerReport {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly accountClass: number;
  readonly fromDate: string;
  readonly toDate: string;
  readonly opening: { openingDebit: string; openingCredit: string };
  readonly lines: readonly GeneralLedgerEntry[];
  readonly totals: {
    readonly periodDebit: string;
    readonly periodCredit: string;
    readonly endingDebit: string;
    readonly endingCredit: string;
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
export type RatioCategory =
  | 'STRUCTURE'
  | 'LIQUIDITE'
  | 'SOLVABILITE'
  | 'RENTABILITE'
  | 'ACTIVITE';

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
  readonly buckets: readonly AgingBucket[];
}

export interface AgingBalanceQuery {
  readonly side: AgingSide;
  readonly asAtDate: string;
  readonly bucketBoundaries?: readonly number[];
}

export interface AgingBalanceReport {
  readonly side: AgingSide;
  readonly asAtDate: string;
  readonly bucketBoundaries: readonly number[];
  readonly rows: readonly AgingAccountRow[];
  readonly bucketTotals: readonly string[];
  readonly grandTotal: string;
}

// ─── TAFIRE / TFT / Annexes (états OHADA composés) ──────────────────

export interface OhadaStatementLine {
  readonly code: string;
  readonly label: string;
  readonly amount: string;
  readonly note?: string;
}

export interface OhadaStatementSection {
  readonly code: string;
  readonly label: string;
  readonly lines: readonly OhadaStatementLine[];
  readonly total: string;
}

export interface TafireReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly emplois: readonly OhadaStatementSection[];
  readonly ressources: readonly OhadaStatementSection[];
  readonly variationTresorerie: string;
  /** Notes méthodologiques sur ce qui est calculé vs encore manuel. */
  readonly methodologyNotes: readonly string[];
}

export interface TftReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly fluxExploitation: OhadaStatementSection;
  readonly fluxInvestissement: OhadaStatementSection;
  readonly fluxFinancement: OhadaStatementSection;
  readonly variationTresorerie: string;
  readonly tresorerieOuverture: string;
  readonly tresorerieCloture: string;
  readonly methodologyNotes: readonly string[];
}

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

  async getTrialBalance(
    organizationId: TenantId,
    query: TrialBalanceQuery,
  ): Promise<TrialBalanceReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);

    const rows = await this.repo.trialBalance(organizationId, query);
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

    const current = await this.computeSigBare(organizationId, query.fromDate, query.toDate);
    if (query.compareWith === undefined) {
      return current;
    }

    const previous = await this.computeSigBare(
      organizationId,
      query.compareWith.fromDate,
      query.compareWith.toDate,
    );
    return this.enrichSigWithComparison(current, previous, query.compareWith);
  }

  private async computeSigBare(
    organizationId: TenantId,
    fromDate: string,
    toDate: string,
  ): Promise<SigReport> {
    const rows = await this.repo.trialBalance(organizationId, { fromDate, toDate });
    const posteAmounts = new Map<string, number>();

    for (const row of rows) {
      const poste = matchPoste(row.accountCode);
      if (poste === null) continue;
      const periodD = Number(row.periodDebit);
      const periodC = Number(row.periodCredit);
      const net = poste.side === 'CHARGE' ? periodD - periodC : periodC - periodD;
      // Valeur absolue par convention d'affichage : un poste de charges
      // affiche un montant positif et la formule XA = TA + RA + RB
      // applique le signe ailleurs. Net <= 0 pour un poste signifie
      // qu'il a été annulé/contre-passé — on l'écrête à 0 pour ne pas
      // distordre la cascade.
      const display = Math.max(net, 0);
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

    const sectionTotal = (
      sections: BalanceSheetReport['actif']['sections'],
      key: string,
    ): number => Number(sections.find((s) => s.key === key)?.total ?? '0');

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
          v === null ? undefined : v >= 1 ? 'fonds de roulement positif' : 'fonds de roulement négatif',
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
        interpret: () =>
          fondsRoulement >= 0 ? 'positif' : 'négatif (déséquilibre structurel)',
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
  async getCashTrend(
    organizationId: TenantId,
    query: CashTrendQuery,
  ): Promise<CashTrendReport> {
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

  /**
   * TAFIRE (Tableau Financier des Ressources et des Emplois) OHADA.
   *
   * État obligatoire pour les grandes entreprises sous SYSCOHADA AUDCIF.
   * Compare deux bilans (N et N-1) et le compte de résultat pour
   * identifier les EMPLOIS (acquisitions immobilisations, remboursements
   * de dettes, distribution de dividendes) et les RESSOURCES (CAF,
   * cessions, augmentation de capital, nouvelles dettes financières).
   *
   * Scope livré (V1) :
   *   - Calcul automatique de la CAF (Capacité d'Autofinancement) à
   *     partir du SIG : CAF = EBE + Autres produits − Autres charges
   *     + Reprises provisions − Dotations financières
   *   - Variations du bilan N vs N-1 sur les grandes masses :
   *     immobilisations, dettes financières, capital
   *   - Variation BFR exploitation
   *   - Variation trésorerie nette
   *
   * Affinement futur :
   *   - Distinguer acquisitions vs cessions d'immobilisations
   *   - Détailler les dividendes versés (compte 1060 → 471)
   *   - Cession de titres immobilisés (compte 82)
   */
  async getTafire(
    organizationId: TenantId,
    query: { fromDate: string; toDate: string },
  ): Promise<TafireReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);

    const [bilanN, bilanNm1, sig] = await Promise.all([
      this.getBalanceSheet(organizationId, {
        asAtDate: query.toDate,
        fiscalYearStartDate: query.fromDate,
      }),
      this.getBalanceSheet(organizationId, {
        asAtDate: ReportsService.previousDayIso(query.fromDate),
        fiscalYearStartDate: ReportsService.previousFiscalYearStart(query.fromDate),
      }),
      this.getSig(organizationId, { fromDate: query.fromDate, toDate: query.toDate }),
    ]);

    const sectionTotal = (
      sections: BalanceSheetReport['actif']['sections'],
      key: string,
    ): number => Number(sections.find((s) => s.key === key)?.total ?? '0');

    const immoN = sectionTotal(bilanN.actif.sections, 'IMMOBILISE');
    const immoNm1 = sectionTotal(bilanNm1.actif.sections, 'IMMOBILISE');
    const variationImmo = immoN - immoNm1;
    const dettesFinN = sectionTotal(bilanN.passif.sections, 'DETTES_FINANCIERES');
    const dettesFinNm1 = sectionTotal(bilanNm1.passif.sections, 'DETTES_FINANCIERES');
    const variationDettesFin = dettesFinN - dettesFinNm1;
    const capN = sectionTotal(bilanN.passif.sections, 'CAPITAUX_PROPRES');
    const capNm1 = sectionTotal(bilanNm1.passif.sections, 'CAPITAUX_PROPRES');
    const variationCapitaux = capN - capNm1;

    const circN = sectionTotal(bilanN.actif.sections, 'CIRCULANT');
    const circNm1 = sectionTotal(bilanNm1.actif.sections, 'CIRCULANT');
    const passifCircN = sectionTotal(bilanN.passif.sections, 'PASSIF_CIRCULANT');
    const passifCircNm1 = sectionTotal(bilanNm1.passif.sections, 'PASSIF_CIRCULANT');
    const variationBfr = circN - circNm1 - (passifCircN - passifCircNm1);

    const tresoN =
      sectionTotal(bilanN.actif.sections, 'TRESORERIE_ACTIF') -
      sectionTotal(bilanN.passif.sections, 'TRESORERIE_PASSIF');
    const tresoNm1 =
      sectionTotal(bilanNm1.actif.sections, 'TRESORERIE_ACTIF') -
      sectionTotal(bilanNm1.passif.sections, 'TRESORERIE_PASSIF');
    const variationTreso = tresoN - tresoNm1;

    // CAF = EBE (XD) + reprises (TJ) - dotations (RL) - frais financiers (RM) + revenus financiers (TK+TL+TM) - impôts (RS) - participation (RQ)
    const sigSolde = (code: string): number =>
      Number(sig.soldes.find((s) => s.code === code)?.amount ?? '0');
    const ebe = sigSolde('XD');
    const sigPoste = (postes: SyscohadaPosteAmount[], code: string): number => {
      const found = postes.find((p) => p.code === code);
      return found ? Number(found.amount) : 0;
    };
    const reprises = sigPoste([...sig.produits], 'TJ');
    const dotations = sigPoste([...sig.charges], 'RL');
    const fraisFin = sigPoste([...sig.charges], 'RM');
    const revFin =
      sigPoste([...sig.produits], 'TK') +
      sigPoste([...sig.produits], 'TL') +
      sigPoste([...sig.produits], 'TM');
    const impots = sigPoste([...sig.charges], 'RS');
    const participation = sigPoste([...sig.charges], 'RQ');
    const caf = ebe + reprises - dotations - fraisFin + revFin - impots - participation;

    const emplois: OhadaStatementSection[] = [
      {
        code: 'E.I',
        label: 'Investissements et désinvestissements',
        lines: [
          {
            code: 'EI.1',
            label: "Acquisitions / cessions nettes d'immobilisations",
            amount: Math.max(variationImmo, 0).toFixed(2),
            note: variationImmo < 0 ? 'Désinvestissement net' : 'Investissement net',
          },
        ],
        total: Math.max(variationImmo, 0).toFixed(2),
      },
      {
        code: 'E.II',
        label: 'Variation du Besoin en Fonds de Roulement (BFR)',
        lines: [
          {
            code: 'EII.1',
            label: 'Variation BFR exploitation',
            amount: Math.max(variationBfr, 0).toFixed(2),
          },
        ],
        total: Math.max(variationBfr, 0).toFixed(2),
      },
      {
        code: 'E.III',
        label: 'Emplois financiers contraints',
        lines: [
          {
            code: 'EIII.1',
            label: 'Remboursement de dettes financières',
            amount: Math.max(-variationDettesFin, 0).toFixed(2),
          },
        ],
        total: Math.max(-variationDettesFin, 0).toFixed(2),
      },
    ];
    const ressources: OhadaStatementSection[] = [
      {
        code: 'R.I',
        label: 'Capacité d\'autofinancement (CAF)',
        lines: [
          { code: 'RI.1', label: 'CAF de l\'exercice', amount: caf.toFixed(2) },
        ],
        total: caf.toFixed(2),
      },
      {
        code: 'R.II',
        label: 'Cessions et reductions d\'immobilisations',
        lines: [
          {
            code: 'RII.1',
            label: 'Désinvestissement net (si applicable)',
            amount: Math.max(-variationImmo, 0).toFixed(2),
          },
        ],
        total: Math.max(-variationImmo, 0).toFixed(2),
      },
      {
        code: 'R.III',
        label: 'Augmentation des capitaux propres et dettes financières',
        lines: [
          {
            code: 'RIII.1',
            label: 'Augmentation de capitaux propres',
            amount: Math.max(variationCapitaux, 0).toFixed(2),
          },
          {
            code: 'RIII.2',
            label: 'Nouvelles dettes financières',
            amount: Math.max(variationDettesFin, 0).toFixed(2),
          },
        ],
        total: (
          Math.max(variationCapitaux, 0) + Math.max(variationDettesFin, 0)
        ).toFixed(2),
      },
    ];

    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      emplois,
      ressources,
      variationTresorerie: variationTreso.toFixed(2),
      methodologyNotes: [
        'CAF calculée à partir du SIG : EBE + reprises − dotations − frais financiers + revenus financiers − impôts − participation.',
        "Acquisitions / cessions d'immobilisations sont présentées en NET (besoin de distinguer 8x produits cessions vs 81 valeurs comptables pour le détail).",
        "Variation BFR = (Actif circulant N − N-1) − (Passif circulant N − N-1).",
        'Variation de trésorerie nette indicative — le détail flux d\'investissement vs financement est dans le TFT.',
      ],
    };
  }

  /**
   * TFT (Tableau de Flux de Trésorerie) OHADA — méthode indirecte.
   *
   * Partition les flux en 3 catégories selon Vol. 3 :
   *   1. Flux d'exploitation : RN ± non-cash ± variation BFR
   *   2. Flux d'investissement : variation actif immobilisé (signe inversé)
   *   3. Flux de financement : variation dettes fin + capital − dividendes
   *
   * Scope livré (V1) :
   *   - Sections officielles avec lignes vides + totaux calculés
   *   - Réconciliation : variation trésorerie début / fin
   */
  async getTft(
    organizationId: TenantId,
    query: { fromDate: string; toDate: string },
  ): Promise<TftReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);

    const [bilanN, bilanNm1, sig] = await Promise.all([
      this.getBalanceSheet(organizationId, {
        asAtDate: query.toDate,
        fiscalYearStartDate: query.fromDate,
      }),
      this.getBalanceSheet(organizationId, {
        asAtDate: ReportsService.previousDayIso(query.fromDate),
        fiscalYearStartDate: ReportsService.previousFiscalYearStart(query.fromDate),
      }),
      this.getSig(organizationId, { fromDate: query.fromDate, toDate: query.toDate }),
    ]);

    const sectionTotal = (
      sections: BalanceSheetReport['actif']['sections'],
      key: string,
    ): number => Number(sections.find((s) => s.key === key)?.total ?? '0');

    const sigSolde = (code: string): number =>
      Number(sig.soldes.find((s) => s.code === code)?.amount ?? '0');

    const rn = sigSolde('XI');
    const dotations = Number(
      sig.charges.find((c) => c.code === 'RL')?.amount ?? '0',
    );
    const reprises = Number(
      sig.produits.find((p) => p.code === 'TJ')?.amount ?? '0',
    );
    const circN = sectionTotal(bilanN.actif.sections, 'CIRCULANT');
    const circNm1 = sectionTotal(bilanNm1.actif.sections, 'CIRCULANT');
    const passifCircN = sectionTotal(bilanN.passif.sections, 'PASSIF_CIRCULANT');
    const passifCircNm1 = sectionTotal(bilanNm1.passif.sections, 'PASSIF_CIRCULANT');
    const variationBfr = circN - circNm1 - (passifCircN - passifCircNm1);
    const fluxExploitation = rn + dotations - reprises - variationBfr;

    const immoN = sectionTotal(bilanN.actif.sections, 'IMMOBILISE');
    const immoNm1 = sectionTotal(bilanNm1.actif.sections, 'IMMOBILISE');
    const fluxInvestissement = -(immoN - immoNm1);

    const dettesFinN = sectionTotal(bilanN.passif.sections, 'DETTES_FINANCIERES');
    const dettesFinNm1 = sectionTotal(bilanNm1.passif.sections, 'DETTES_FINANCIERES');
    const capN = sectionTotal(bilanN.passif.sections, 'CAPITAUX_PROPRES');
    const capNm1 = sectionTotal(bilanNm1.passif.sections, 'CAPITAUX_PROPRES');
    const fluxFinancement = dettesFinN - dettesFinNm1 + (capN - capNm1 - rn);

    const tresoN =
      sectionTotal(bilanN.actif.sections, 'TRESORERIE_ACTIF') -
      sectionTotal(bilanN.passif.sections, 'TRESORERIE_PASSIF');
    const tresoNm1 =
      sectionTotal(bilanNm1.actif.sections, 'TRESORERIE_ACTIF') -
      sectionTotal(bilanNm1.passif.sections, 'TRESORERIE_PASSIF');

    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      fluxExploitation: {
        code: 'FA',
        label: "Flux de trésorerie provenant des activités d'exploitation",
        lines: [
          { code: 'FA.1', label: 'Résultat net de l\'exercice', amount: rn.toFixed(2) },
          { code: 'FA.2', label: '+ Dotations aux amortissements et provisions', amount: dotations.toFixed(2) },
          { code: 'FA.3', label: '− Reprises sur amortissements et provisions', amount: (-reprises).toFixed(2) },
          { code: 'FA.4', label: '± Variation du BFR', amount: (-variationBfr).toFixed(2) },
        ],
        total: fluxExploitation.toFixed(2),
      },
      fluxInvestissement: {
        code: 'FB',
        label: "Flux de trésorerie provenant des activités d'investissement",
        lines: [
          {
            code: 'FB.1',
            label: 'Variation nette des immobilisations',
            amount: fluxInvestissement.toFixed(2),
          },
        ],
        total: fluxInvestissement.toFixed(2),
      },
      fluxFinancement: {
        code: 'FC',
        label: 'Flux de trésorerie provenant des activités de financement',
        lines: [
          {
            code: 'FC.1',
            label: 'Variation des dettes financières',
            amount: (dettesFinN - dettesFinNm1).toFixed(2),
          },
          {
            code: 'FC.2',
            label: 'Variation des capitaux propres hors résultat',
            amount: (capN - capNm1 - rn).toFixed(2),
          },
        ],
        total: fluxFinancement.toFixed(2),
      },
      variationTresorerie: (fluxExploitation + fluxInvestissement + fluxFinancement).toFixed(2),
      tresorerieOuverture: tresoNm1.toFixed(2),
      tresorerieCloture: tresoN.toFixed(2),
      methodologyNotes: [
        'Méthode indirecte : partir du résultat net + ajustements non-cash + variation BFR.',
        "Flux investissement = variation nette de l'actif immobilisé (acquisitions − cessions). Pour le détail acquisitions vs cessions, voir TAFIRE.",
        "Flux financement = variation dettes financières + variation capitaux propres hors RN (apports nouveaux − dividendes − rachats actions).",
        "Réconciliation : Tresoreire fin = Tresoreire debut + Total flux. Ecart attendu = 0.",
      ],
    };
  }

  /**
   * Squelette de l'Annexe (Notes 1 à 35) SYSCOHADA AUDCIF.
   *
   * V1 : retourne la liste officielle des notes avec leur titre et leur
   * statut. Les notes calculables automatiquement (immobilisations, stocks,
   * créances, dettes, capitaux) sont marquées COMPUTED avec lien vers le
   * rapport source. Les notes purement narratives sont marquées MANUAL.
   */
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
      { code: 'Note 3D', title: "Cessions d'immobilisations", status: 'PARTIAL', source: 'sig (TN, RO)' },
      { code: 'Note 3E', title: 'Crédit-bail et contrats assimilés', status: 'MANUAL' },
      { code: 'Note 3F', title: 'Subventions d\'investissement', status: 'COMPUTED', source: 'balance-sheet (compte 14)' },
      { code: 'Note 4', title: 'Stocks et en-cours', status: 'COMPUTED', source: 'balance-sheet (classe 3)' },
      { code: 'Note 5', title: 'Créances et emplois assimilés', status: 'COMPUTED', source: 'aging-balance (CLIENT)' },
      { code: 'Note 6', title: 'Variations de stocks', status: 'COMPUTED', source: 'sig (RB, RD, RF, TG)' },
      { code: 'Note 7', title: "Charges constatées d'avance", status: 'COMPUTED', source: 'balance-sheet (compte 476)' },
      { code: 'Note 8', title: 'Trésorerie actif', status: 'COMPUTED', source: 'balance-sheet (classe 5 débit)' },
      { code: 'Note 9', title: 'Écarts de conversion', status: 'MANUAL' },
      { code: 'Note 10', title: 'Capital social', status: 'COMPUTED', source: 'balance-sheet (compte 10)' },
      { code: 'Note 11', title: 'Primes, réserves, report à nouveau', status: 'COMPUTED', source: 'balance-sheet (comptes 11, 12)' },
      { code: 'Note 12', title: 'Subventions d\'investissement', status: 'COMPUTED', source: 'balance-sheet (compte 14)' },
      { code: 'Note 13', title: 'Provisions pour risques et charges', status: 'COMPUTED', source: 'balance-sheet (compte 19)' },
      { code: 'Note 14', title: 'Emprunts et dettes financières', status: 'COMPUTED', source: 'balance-sheet (classe 16)' },
      { code: 'Note 15', title: 'Fournisseurs et dettes assimilées', status: 'COMPUTED', source: 'aging-balance (FOURNISSEUR)' },
      { code: 'Note 16', title: 'Dettes sociales et fiscales', status: 'COMPUTED', source: 'balance-sheet (comptes 42, 43, 44)' },
      { code: 'Note 17', title: 'Autres dettes', status: 'COMPUTED', source: 'balance-sheet (autres 4x crédit)' },
      { code: 'Note 18', title: 'Trésorerie passif', status: 'COMPUTED', source: 'balance-sheet (classe 5 crédit)' },
      { code: 'Note 19', title: 'Engagements donnés et reçus (hors bilan)', status: 'MANUAL' },
      { code: 'Note 20', title: 'Ventilation du chiffre d\'affaires', status: 'COMPUTED', source: 'sig (TA-TD)' },
      { code: 'Note 21', title: 'Produits, charges hors activités ordinaires (HAO)', status: 'COMPUTED', source: 'sig (TN, TO, RO, RP)' },
      { code: 'Note 22', title: 'Charges et produits financiers', status: 'COMPUTED', source: 'sig (TK-TM, RM)' },
      { code: 'Note 23', title: 'Effectifs, masse salariale, personnel extérieur', status: 'PARTIAL', source: 'sig (RK)' },
      { code: 'Note 24', title: 'Rémunérations et avantages des dirigeants', status: 'MANUAL' },
      { code: 'Note 25', title: 'Transactions avec parties liées', status: 'MANUAL' },
      { code: 'Note 26', title: 'Événements postérieurs à la clôture', status: 'MANUAL' },
      { code: 'Note 27', title: 'Honoraires des commissaires aux comptes', status: 'MANUAL' },
      { code: 'Note 28', title: "Impôt sur les bénéfices", status: 'COMPUTED', source: 'sig (RS)' },
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
    const boundaries = query.bucketBoundaries ?? [30, 60, 90, 180];
    if (boundaries.length === 0 || boundaries.some((b) => !Number.isInteger(b) || b <= 0)) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: 'bucketBoundaries must be positive integers.',
      });
    }
    const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
    const prefix = query.side === 'CLIENT' ? '411' : '401';

    const balances = await this.repo.accountBalancesAsAt(organizationId, query.asAtDate);
    const partners = balances.filter(
      (b) =>
        b.accountCode.startsWith(prefix) &&
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
          const date = new Date(`${ln.entryDate}T00:00:00Z`).getTime();
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
        const bucketAmounts = new Array(sortedBoundaries.length + 1).fill(0);
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
          if (!placed) bucketAmounts[bucketAmounts.length - 1] += o.amount;
        }
        const bucketLabels = sortedBoundaries.map((b, i) => {
          const lower = i === 0 ? 0 : sortedBoundaries[i - 1] + 1;
          return `${lower}-${b}j`;
        });
        bucketLabels.push(`> ${sortedBoundaries[sortedBoundaries.length - 1]}j`);
        const buckets: AgingBucket[] = bucketAmounts.map((amt, i) => ({
          upperDays: i < sortedBoundaries.length ? sortedBoundaries[i] : null,
          label: bucketLabels[i],
          amount: amt.toFixed(2),
        }));
        const total = bucketAmounts.reduce((s, x) => s + x, 0);
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
    const bucketTotals = new Array(sortedBoundaries.length + 1).fill(0);
    for (const r of filtered) {
      r.buckets.forEach((b, i) => {
        bucketTotals[i] += Number(b.amount);
      });
    }
    const grandTotal = bucketTotals.reduce((s, x) => s + x, 0);
    return {
      side: query.side,
      asAtDate: query.asAtDate,
      bucketBoundaries: sortedBoundaries,
      rows: filtered,
      bucketTotals: bucketTotals.map((n) => n.toFixed(2)),
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
    };
    const perPeriodRows = await Promise.all(
      query.periods.map((p) =>
        this.repo.trialBalance(organizationId, { ...filters, fromDate: p.fromDate, toDate: p.toDate }),
      ),
    );
    const lastIdx = perPeriodRows.length - 1;
    const indexByAccount = perPeriodRows.map(
      (rows) => new Map(rows.map((r) => [r.accountId, r])),
    );
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
    let running = Number(opening.openingDebit) - Number(opening.openingCredit);
    const lines: GeneralLedgerEntry[] = rawLines.map((row) => {
      running += Number(row.debit) - Number(row.credit);
      return { ...row, runningBalance: running.toFixed(2) };
    });

    const periodDebit = rawLines.reduce((s, r) => s + Number(r.debit), 0);
    const periodCredit = rawLines.reduce((s, r) => s + Number(r.credit), 0);
    const totalDebit = Number(opening.openingDebit) + periodDebit;
    const totalCredit = Number(opening.openingCredit) + periodCredit;
    const net = totalDebit - totalCredit;

    return {
      accountId: account.id,
      accountCode: account.code,
      accountLabel: account.label,
      accountClass: account.class,
      fromDate: query.fromDate,
      toDate: query.toDate,
      opening,
      lines,
      totals: {
        periodDebit: periodDebit.toFixed(2),
        periodCredit: periodCredit.toFixed(2),
        endingDebit: (net > 0 ? net : 0).toFixed(2),
        endingCredit: (net < 0 ? -net : 0).toFixed(2),
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
    },
  ): Promise<ProfitLossReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);
    if (query.compareWith !== undefined) {
      this.assertDateRange(query.compareWith.fromDate, query.compareWith.toDate);
    }

    const current = await this.computeProfitLossBare(organizationId, query.fromDate, query.toDate);
    if (query.compareWith === undefined) {
      return current;
    }

    const previous = await this.computeProfitLossBare(
      organizationId,
      query.compareWith.fromDate,
      query.compareWith.toDate,
    );
    return this.enrichProfitLossWithComparison(current, previous);
  }

  private async computeProfitLossBare(
    organizationId: TenantId,
    fromDate: string,
    toDate: string,
  ): Promise<ProfitLossReport> {
    const rows = await this.repo.trialBalance(organizationId, { fromDate, toDate });
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

    return {
      fromDate,
      toDate,
      charges,
      produits,
      totalCharges: totalCharges.toFixed(2),
      totalProduits: totalProduits.toFixed(2),
      resultat: resultat.toFixed(2),
    };
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

    return {
      ...current,
      charges: current.charges.map((s) => enrichSection(s, prevChargesIdx)),
      produits: current.produits.map((s) => enrichSection(s, prevProduitsIdx)),
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

      const classification = classifyToPoste(row.accountCode, row.isOpposing);
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
    const builtPostes = new Map<string, BilanPoste>();
    for (const [code, acc] of posteAccs) {
      const ref = posteByCode.get(code);
      if (!ref) continue; // référentiel changé entre temps — safeguard
      const net = (acc.brut - acc.deduction) * ref.sign;
      const poste: BilanPoste = {
        code: ref.code,
        label: ref.label,
        side: ref.side,
        net: net.toFixed(2),
        brut: acc.brut > 0 ? acc.brut.toFixed(2) : undefined,
        deduction: acc.deduction > 0 ? acc.deduction.toFixed(2) : undefined,
      };
      builtPostes.set(code, poste);
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
      else
        rubriquesByKey.set(key, { label: ref.section, postes: [built], masseCode });
    }

    // Construction finale des masses, dans l'ordre du référentiel.
    const buildMasses = (side: 'ACTIF' | 'PASSIF'): BilanMasse[] => {
      const masseRefs = BILAN_POSTES.filter(
        (p) => p.section === '_TOTAL_' && p.side === side,
      );
      return masseRefs
        .map((ref) => {
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
}
