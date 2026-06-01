/**
 * États MULTI-PÉRIODES dérivables de balances de SOLDES uploadées
 * (sans accès base, fonctions PURES). Complète
 * `ReportsService.getReportsFromBalance` lorsque l'appelant fournit, en
 * plus de l'exercice N, la balance de l'exercice ANTÉRIEUR (N-1) et
 * optionnellement N-2 :
 *
 *   - `buildComparativeFromRows`  → Balance comparative N vs N-1
 *                                   (ComparativeBalanceReport)
 *   - `buildTftFromRows`          → Tableau des Flux de Trésorerie
 *                                   (CashFlowReport), codes ZA-ZH
 *   - `buildMultiYearFromRows`    → Balance pluriannuelle N/N-1[/N-2]
 *                                   (MultiYearBalanceReport)
 *
 * CONVENTIONS — strictement alignées sur l'existant :
 *   - Une balance de SOLDES porte le solde cumulé d'un compte dans ses
 *     colonnes `debit`/`credit`. Comme `getReportsFromBalance` (cf.
 *     `trialRows`), on projette ce solde sur `periodDebit = debit`,
 *     `periodCredit = credit`, `endingDebit = debit`,
 *     `endingCredit = credit` (pas d'à-nouveaux distincts en
 *     from-balance). Les algorithmes de flux (variations N vs N-1)
 *     comparent donc deux instantanés cumulés — exactement comme
 *     `CashFlowService.computeBare` compare `accountBalancesAsAt(toDate)`
 *     et `accountBalancesAsAt(previousToDate)`.
 *
 *   - Le TFT RÉPLIQUE FIDÈLEMENT `CashFlowService.computeBare` : mêmes
 *     postes FA-FQ, mêmes sous-totaux ZB/ZC/ZD/ZE/ZF, même variation ZG,
 *     même clôture ZH = ZA + ZG, mêmes EXCLUSIONS BFR (Article 9 Vol. 3
 *     SYSCOHADA). Les helpers statiques de calcul de flux sont réutilisés
 *     tels quels (DRY) — on ne réinvente pas la doctrine. Seules les deux
 *     sources I/O de `computeBare` sont remplacées par des sources PURES :
 *       · `accountBalancesAsAt`  → conversion directe des rows en soldes
 *         bruts `{ accountCode, totalDebit, totalCredit, isOpposing }` ;
 *       · `reports.getSig`       → `buildSigFromRows` (helper pur
 *         existant, même cascade XA-XI).
 *
 * Aucune donnée n'est fabriquée : tout est dérivé des soldes fournis.
 */
import type { TrialBalanceRow } from '../repositories/reports.repository';
import {
  BFR_EXCLUDED_PREFIXES,
  CashFlowService,
  type CashFlowReport,
  IMMOBILISATION_FIN_PREFIXES,
  DETTES_FIN_PREFIXES,
  type PeriodMovement,
  type SignedAccountBalance,
} from './cash-flow.service';
import { buildSigFromRows } from './from-balance-states';
import { getTftLabel } from './postes/tft-postes';
import type {
  ComparativeBalanceReport,
  ComparativeBalanceRow,
  ComparativeBalanceTotals,
  MultiYearBalanceReport,
  MultiYearBalanceRow,
  MultiYearPeriod,
} from './reports.service';

/** Une ligne de balance de soldes telle que reçue par `getReportsFromBalance`. */
export interface BalanceRow {
  readonly code: string;
  readonly label: string;
  readonly debit: string;
  readonly credit: string;
}

const EPSILON = 0.005;

// référence implicite pour conserver l'import et documenter l'origine
// doctrinale des exclusions BFR appliquées par les helpers statiques.
void BFR_EXCLUDED_PREFIXES;

/** `percentChange` répliqué de `ReportsService.percentChange` (pur, statique). */
function percentChange(previous: number, current: number): string | null {
  if (Math.abs(previous) < EPSILON) return null;
  return (((current - previous) / Math.abs(previous)) * 100).toFixed(2);
}

/**
 * Projette une balance de soldes en `TrialBalanceRow[]`, à l'identique de
 * la construction de `trialRows` dans `getReportsFromBalance` (DRY).
 */
function toTrialRows(rows: readonly BalanceRow[]): TrialBalanceRow[] {
  return rows.map((r) => ({
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
}

/**
 * Convertit une balance de soldes en soldes BRUTS au format attendu par
 * `CashFlowService.toSignedBalances` — la marque `isOpposing` reprend la
 * même règle que `getReportsFromBalance` (28/29/39/491/499/59).
 */
function toRawBalances(
  rows: readonly BalanceRow[],
): Array<{ accountCode: string; totalDebit: string; totalCredit: string; isOpposing: boolean }> {
  return rows.map((r) => ({
    accountCode: r.code,
    totalDebit: r.debit || '0',
    totalCredit: r.credit || '0',
    isOpposing: /^(28|29|39|491|499|59)/.test(r.code),
  }));
}

// ─────────────────────────────────────────────────────────────────────
// 1. Balance comparative N vs N-1
// ─────────────────────────────────────────────────────────────────────

/**
 * Construit une balance comparative N vs N-1 depuis deux balances de
 * soldes. Réplique la logique de fusion de
 * `ReportsService.getComparativeBalance` / `buildComparativeRow` :
 * apparie par code de compte, calcule la variation des mouvements nets,
 * et conserve les comptes présents dans une seule des deux périodes.
 *
 * En from-balance, les mouvements de période sont assimilés au solde
 * cumulé (cf. conventions du module) : `periodDebit = debit`,
 * `periodCredit = credit`, et le SOLDE de référence est celui de N.
 */
export function buildComparativeFromRows(
  rowsN: readonly BalanceRow[],
  asAtN: string,
  rowsN1: readonly BalanceRow[],
  asAtN1: string,
): ComparativeBalanceReport {
  const previousIndex = new Map(rowsN1.map((r) => [r.code, r]));
  const seen = new Set<string>();
  const merged: ComparativeBalanceRow[] = [];

  const buildRow = (cur: BalanceRow | undefined, prev: BalanceRow | undefined): ComparativeBalanceRow => {
    const source = cur ?? prev;
    if (source === undefined) {
      throw new Error('buildComparativeFromRows: both current and previous are undefined.');
    }
    const prevD = prev ? Number(prev.debit || '0') : 0;
    const prevC = prev ? Number(prev.credit || '0') : 0;
    const curD = cur ? Number(cur.debit || '0') : 0;
    const curC = cur ? Number(cur.credit || '0') : 0;
    const prevNet = prevD - prevC;
    const curNet = curD - curC;
    const variation = curNet - prevNet;

    // SOLDE = côté de N quand disponible, sinon repli sur N-1.
    const endingSource = cur ?? prev;
    const eD = Number(endingSource?.debit || '0');
    const eC = Number(endingSource?.credit || '0');

    const accountClass = Math.min(9, Math.max(1, parseInt(source.code[0] ?? '9') || 9));
    return {
      accountId: source.code,
      accountCode: source.code,
      accountLabel: source.label,
      accountClass,
      previousPeriodDebit: prevD.toFixed(2),
      previousPeriodCredit: prevC.toFixed(2),
      periodDebit: curD.toFixed(2),
      periodCredit: curC.toFixed(2),
      endingDebit: eD.toFixed(2),
      endingCredit: eC.toFixed(2),
      netVariation: variation.toFixed(2),
      netVariationPercent: percentChange(prevNet, curNet),
    };
  };

  for (const cur of rowsN) {
    seen.add(cur.code);
    merged.push(buildRow(cur, previousIndex.get(cur.code)));
  }
  for (const prev of rowsN1) {
    if (seen.has(prev.code)) continue;
    merged.push(buildRow(undefined, prev));
  }
  merged.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  const sum = (key: keyof ComparativeBalanceRow): number =>
    merged.reduce((s, r) => s + Number(r[key] as string), 0);
  const totals: ComparativeBalanceTotals = {
    previousPeriodDebit: sum('previousPeriodDebit').toFixed(2),
    previousPeriodCredit: sum('previousPeriodCredit').toFixed(2),
    periodDebit: sum('periodDebit').toFixed(2),
    periodCredit: sum('periodCredit').toFixed(2),
    endingDebit: sum('endingDebit').toFixed(2),
    endingCredit: sum('endingCredit').toFixed(2),
  };

  // En from-balance, fromDate = début d'exercice (slice de l'année).
  const fromN = `${asAtN.slice(0, 4)}-01-01`;
  const fromN1 = `${asAtN1.slice(0, 4)}-01-01`;
  return {
    fromDate: fromN,
    toDate: asAtN,
    previousFromDate: fromN1,
    previousToDate: asAtN1,
    rows: merged,
    totals,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 2. Tableau des Flux de Trésorerie (TFT) — réplique de computeBare
// ─────────────────────────────────────────────────────────────────────

/**
 * Construit le TFT (méthode indirecte) depuis deux balances de soldes
 * (N et N-1). RÉPLIQUE FIDÈLEMENT `CashFlowService.computeBare` :
 *
 *   - Sources I/O remplacées par des sources PURES :
 *       · balanceN / balanceN1 ← conversion des rows en soldes bruts ;
 *       · SIG N                ← `buildSigFromRows` (même cascade XA-XI).
 *   - `movements` (PeriodMovement) ← mêmes period* que les trialRows
 *     from-balance (solde cumulé = mouvement, faute d'à-nouveaux).
 *   - Toute l'arithmétique FA-FQ, ZB-ZH et le contrôle de cohérence
 *     reprennent les helpers statiques de `CashFlowService` à l'identique
 *     (DRY). Exclusions BFR strictes (Article 9 Vol. 3 SYSCOHADA)
 *     appliquées par `isExcludedFromBfr`.
 */
export function buildTftFromRows(
  rowsN: readonly BalanceRow[],
  asAtN: string,
  rowsN1: readonly BalanceRow[],
  asAtN1: string,
  fiscalYearStartDate?: string,
): CashFlowReport {
  // `asAtN1` n'intervient pas dans le calcul des flux (computeBare déduit
  // l'ouverture ZA des SOLDES N-1, pas de leur date) ; conservé dans la
  // signature pour la symétrie avec les autres builders multi-périodes.
  void asAtN1;
  const fromDate = fiscalYearStartDate ?? `${asAtN.slice(0, 4)}-01-01`;
  const toDate = asAtN;

  // ── Sources (équivalents purs des appels I/O de computeBare) ───────
  const signedN: SignedAccountBalance[] = CashFlowService.toSignedBalances(toRawBalances(rowsN));
  const signedN1: SignedAccountBalance[] = CashFlowService.toSignedBalances(toRawBalances(rowsN1));
  const sigN = buildSigFromRows(toTrialRows(rowsN), fromDate, toDate);

  // En from-balance, le mouvement de période est assimilé au solde
  // cumulé de N (pas d'à-nouveaux), comme dans `trialRows`.
  const movements: PeriodMovement[] = rowsN.map((r) => ({
    accountCode: r.code,
    debit: Number(r.debit || '0'),
    credit: Number(r.credit || '0'),
  }));

  // ── ZA / clôture réelle ────────────────────────────────────────────
  const openingCash = CashFlowService.netTreasury(signedN1);
  const treasuryAtToDate = CashFlowService.netTreasury(signedN);

  // ── FA — CAFG (réplique exacte de computeBare) ─────────────────────
  const xd = Number(sigN.soldes.find((s) => s.code === 'XD')?.amount ?? '0');
  const xf = Number(sigN.soldes.find((s) => s.code === 'XF')?.amount ?? '0');
  const c654 = CashFlowService.sumPeriodForPrefix(movements, '654', 'debit-credit');
  const c754 = CashFlowService.sumPeriodForPrefix(movements, '754', 'credit-debit');
  const to = Number(sigN.produits.find((p) => p.code === 'TO')?.amount ?? '0');
  const rp = Number(sigN.charges.find((c) => c.code === 'RP')?.amount ?? '0');
  const rq = Number(sigN.charges.find((c) => c.code === 'RQ')?.amount ?? '0');
  const rs = Number(sigN.charges.find((c) => c.code === 'RS')?.amount ?? '0');
  const fa = xd + c654 - c754 + xf + to + rp + rq + rs;

  // ── FB-FE — variations BFR (exclusions strictes Article 9) ─────────
  const fb = 0;
  const fc = -CashFlowService.deltaSignedByFilter(
    signedN1,
    signedN,
    (code) => code.startsWith('3') && !code.startsWith('39'),
  );
  const fd = -CashFlowService.deltaSignedByFilter(
    signedN1,
    signedN,
    (code) =>
      code.startsWith('4') &&
      !CashFlowService.isExcludedFromBfr(code) &&
      CashFlowService.netForCode(signedN, code) >= 0 &&
      CashFlowService.netForCode(signedN1, code) >= 0,
  );
  const fe = -CashFlowService.deltaSignedByFilter(
    signedN1,
    signedN,
    (code) =>
      code.startsWith('4') &&
      !CashFlowService.isExcludedFromBfr(code) &&
      (CashFlowService.netForCode(signedN, code) < 0 ||
        CashFlowService.netForCode(signedN1, code) < 0),
  );
  const zb = fa + fb + fc + fd + fe;

  // ── FF-FJ — flux d'investissement ──────────────────────────────────
  const ff = -CashFlowService.sumDebitForPrefixes(
    movements,
    ['20', '21'],
    (code) => !code.startsWith('28') && !code.startsWith('29'),
  );
  const fg = -CashFlowService.sumDebitForPrefixes(
    movements,
    ['22', '23', '24', '25'],
    (code) => !code.startsWith('28') && !code.startsWith('29'),
  );
  const fh = -CashFlowService.sumDebitForPrefixes(
    movements,
    IMMOBILISATION_FIN_PREFIXES,
    (code) => !code.startsWith('28') && !code.startsWith('29'),
  );
  const deltaCreancesCession = CashFlowService.deltaSignedByFilter(
    signedN1,
    signedN,
    (code) => code.startsWith('485') || code.startsWith('414'),
  );
  const fi =
    CashFlowService.sumPeriodForPrefix(movements, '82', 'credit-debit') + deltaCreancesCession;
  const fj = CashFlowService.sumCreditForPrefixes(movements, IMMOBILISATION_FIN_PREFIXES);
  const zc = ff + fg + fh + fi + fj;

  // ── FK-FN — flux financement capitaux propres ──────────────────────
  const fk = CashFlowService.deltaSignedByFilter(
    signedN1,
    signedN,
    (code) => code.startsWith('10') && !code.startsWith('106') && !code.startsWith('109'),
  );
  const fl = CashFlowService.deltaSignedByFilter(signedN1, signedN, (code) =>
    code.startsWith('14'),
  );
  const fm = -CashFlowService.sumDebitForPrefixes(movements, ['4581', '4582']);
  const fn = -CashFlowService.sumPeriodForPrefix(movements, '465', 'debit-credit');
  const zd = fk + fl + fm + fn;

  // ── FO-FQ — flux financement capitaux étrangers ────────────────────
  const fo = CashFlowService.sumCreditForPrefixes(movements, ['16', '17']);
  const fp = CashFlowService.sumCreditForPrefixes(movements, ['18']);
  const fq = -CashFlowService.sumDebitForPrefixes(movements, DETTES_FIN_PREFIXES);
  const ze = fo + fp + fq;

  // ── ZF, ZG, ZH + contrôle ──────────────────────────────────────────
  const zf = zd + ze;
  const zg = zb + zc + zf;
  const zh = openingCash + zg;
  const coherence = zh - treasuryAtToDate;

  return {
    fromDate,
    toDate,
    openingCash: openingCash.toFixed(2),
    operatingFlows: {
      code: 'ZB',
      label: getTftLabel('ZB'),
      subtotal: zb.toFixed(2),
      postes: [
        {
          code: 'FA',
          label: getTftLabel('FA'),
          amount: fa.toFixed(2),
          source: 'XD + 654 - 754 + XF + TO + RP + RQ + RS',
        },
        {
          code: 'FB',
          label: getTftLabel('FB'),
          amount: fb.toFixed(2),
          source: 'actif circulant HAO (compte 485 — traité en section invest.)',
        },
        { code: 'FC', label: getTftLabel('FC'), amount: fc.toFixed(2), source: 'classe 3 hors 39' },
        {
          code: 'FD',
          label: getTftLabel('FD'),
          amount: fd.toFixed(2),
          source: 'classe 4 actif hors exclusions',
        },
        {
          code: 'FE',
          label: getTftLabel('FE'),
          amount: fe.toFixed(2),
          source: 'classe 4 passif hors exclusions',
        },
      ],
    },
    investingFlows: {
      code: 'ZC',
      label: getTftLabel('ZC'),
      subtotal: zc.toFixed(2),
      postes: [
        { code: 'FF', label: getTftLabel('FF'), amount: ff.toFixed(2), source: 'débits 20-21 hors 28/29' },
        { code: 'FG', label: getTftLabel('FG'), amount: fg.toFixed(2), source: 'débits 22-25 hors 28/29' },
        { code: 'FH', label: getTftLabel('FH'), amount: fh.toFixed(2), source: 'débits 26-27' },
        { code: 'FI', label: getTftLabel('FI'), amount: fi.toFixed(2), source: 'crédit 82 − Δ(485+414)' },
        { code: 'FJ', label: getTftLabel('FJ'), amount: fj.toFixed(2), source: 'crédits 26-27' },
      ],
    },
    financingFlowsEquity: {
      code: 'ZD',
      label: getTftLabel('ZD'),
      subtotal: zd.toFixed(2),
      postes: [
        { code: 'FK', label: getTftLabel('FK'), amount: fk.toFixed(2), source: 'Δ classe 10 hors 106/109' },
        { code: 'FL', label: getTftLabel('FL'), amount: fl.toFixed(2), source: 'Δ classe 14' },
        { code: 'FM', label: getTftLabel('FM'), amount: fm.toFixed(2), source: 'débits 4581/4582' },
        { code: 'FN', label: getTftLabel('FN'), amount: fn.toFixed(2), source: 'débits 465' },
      ],
    },
    financingFlowsDebt: {
      code: 'ZE',
      label: getTftLabel('ZE'),
      subtotal: ze.toFixed(2),
      postes: [
        { code: 'FO', label: getTftLabel('FO'), amount: fo.toFixed(2), source: 'crédits 16-17' },
        { code: 'FP', label: getTftLabel('FP'), amount: fp.toFixed(2), source: 'crédits 18' },
        { code: 'FQ', label: getTftLabel('FQ'), amount: fq.toFixed(2), source: 'débits 16-18' },
      ],
    },
    financingFlowsTotal: zf.toFixed(2),
    netCashVariation: zg.toFixed(2),
    closingCash: zh.toFixed(2),
    coherenceCheck: coherence.toFixed(2),
  };
}

// ─────────────────────────────────────────────────────────────────────
// 3. Balance pluriannuelle N/N-1[/N-2]
// ─────────────────────────────────────────────────────────────────────

/**
 * Construit une balance pluriannuelle (2 à 3 périodes en from-balance)
 * depuis une liste de balances de soldes. Réplique
 * `ReportsService.getMultiYearBalance` : apparie par code, un net par
 * période, solde = côté de la DERNIÈRE période. Ordre attendu : N en
 * premier, puis N-1, puis N-2 — le SOLDE final reflète donc la dernière
 * entrée fournie.
 */
export function buildMultiYearFromRows(
  periods: ReadonlyArray<{ rows: readonly BalanceRow[]; asAtDate: string }>,
): MultiYearBalanceReport {
  if (periods.length < 2 || periods.length > 3) {
    throw new Error('buildMultiYearFromRows: requires 2 to 3 periods (N, N-1, [N-2]).');
  }

  const indexByAccount = periods.map((p) => new Map(p.rows.map((r) => [r.code, r])));
  const lastIdx = periods.length - 1;
  const allCodes = new Set<string>();
  for (const p of periods) for (const r of p.rows) allCodes.add(r.code);

  const merged: MultiYearBalanceRow[] = [];
  for (const code of allCodes) {
    const sample = periods.map((p) => p.rows.find((r) => r.code === code)).find((r) => r !== undefined);
    if (sample === undefined) continue;
    const netByPeriod = indexByAccount.map((m) => {
      const r = m.get(code);
      if (r === undefined) return '0.00';
      return (Number(r.debit || '0') - Number(r.credit || '0')).toFixed(2);
    });
    const last = indexByAccount[lastIdx].get(code);
    const endingDebit = (Number(last?.debit ?? '0') || 0).toFixed(2);
    const endingCredit = (Number(last?.credit ?? '0') || 0).toFixed(2);
    const accountClass = Math.min(9, Math.max(1, parseInt(sample.code[0] ?? '9') || 9));
    merged.push({
      accountId: sample.code,
      accountCode: sample.code,
      accountLabel: sample.label,
      accountClass,
      netByPeriod,
      endingDebit,
      endingCredit,
    });
  }
  merged.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  const reportPeriods: MultiYearPeriod[] = periods.map((p) => ({
    fromDate: `${p.asAtDate.slice(0, 4)}-01-01`,
    toDate: p.asAtDate,
  }));
  return { periods: reportPeriods, rows: merged };
}
