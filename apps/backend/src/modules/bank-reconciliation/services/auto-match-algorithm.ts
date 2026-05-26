/**
 * Module 15 — algorithme d'auto-matching ligne relevé ↔ ligne(s) écriture.
 *
 * Wave 1 : 1:1 strict (montant exact signé, date ±5j, score Jaro-Winkler).
 *
 * Wave 2 (N:M) : si `enableMultiLine`, on tente en plus des combinaisons
 * de 2..maxCombinationSize lignes d'écriture dont la somme matche la
 * ligne de relevé ± `amountTolerance`. Recherche subset-sum bornée :
 *   - candidats restreints aux lignes proches en date (≤ maxDateDistanceDays
 *     × 2 jours) pour éviter l'explosion combinatoire ;
 *   - tailles 2..maxCombinationSize ;
 *   - première combinaison trouvée dans l'ordre de proximité gagne ;
 *   - plafond dur `MAX_COMBINATION_HARD_CAP = 10` pour éviter les O(C(n, k))
 *     pathologiques sur de gros relevés.
 *
 * Les propositions 1:1 et 1:N partagent la même priorité — les 1:1 sont
 * privilégiées (score), les 1:N viennent compléter pour les lignes
 * restantes.
 */

export interface AutoMatchInputStatementLine {
  readonly id: string;
  readonly operationDate: string;
  readonly label: string;
  readonly amount: string;
}

export interface AutoMatchInputEntryLine {
  readonly id: string;
  readonly entryDate: string;
  readonly description: string | null;
  readonly signedAmount: string;
}

export type MatchType = '1_to_1' | '1_to_n';

export interface AutoMatchProposal {
  readonly statementLineId: string;
  readonly journalEntryLineId: string;
  readonly confidenceScore: number;
}

export interface AutoMatchProposalV2 {
  readonly matchType: MatchType;
  readonly statementLineId: string;
  readonly journalEntryLineIds: ReadonlyArray<string>;
  readonly confidenceScore: number;
}

export interface AutoMatchOptions {
  readonly minScore?: number;
  readonly maxDateDistanceDays?: number;
}

export interface AutoMatchOptionsV2 extends AutoMatchOptions {
  readonly enableMultiLine?: boolean;
  /** Tolérance absolue (devise) entre somme entry lines et bank amount. */
  readonly amountTolerance?: number;
  /** Plafond souhaité ; sera coupé à MAX_COMBINATION_HARD_CAP. */
  readonly maxCombinationSize?: number;
}

const DEFAULT_MIN_SCORE = 50;
const DEFAULT_MAX_DATE_DISTANCE = 5;
const DEFAULT_MAX_COMBINATION_SIZE = 5;
const MAX_COMBINATION_HARD_CAP = 10;
const DATE_WEIGHT = 80;
const LABEL_WEIGHT = 20;

export function proposeAutoMatches(
  statementLines: ReadonlyArray<AutoMatchInputStatementLine>,
  entryLines: ReadonlyArray<AutoMatchInputEntryLine>,
  options: AutoMatchOptions = {},
): ReadonlyArray<AutoMatchProposal> {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const maxDateDistance = options.maxDateDistanceDays ?? DEFAULT_MAX_DATE_DISTANCE;

  type Candidate = {
    readonly statementLineId: string;
    readonly journalEntryLineId: string;
    readonly score: number;
  };

  const candidates: Candidate[] = [];

  for (const stLine of statementLines) {
    const stAmount = Number(stLine.amount);
    for (const entry of entryLines) {
      const entryAmount = Number(entry.signedAmount);
      if (stAmount.toFixed(2) !== entryAmount.toFixed(2)) continue;

      const days = Math.abs(daysBetween(stLine.operationDate, entry.entryDate));
      if (days > maxDateDistance) continue;

      const dateScore = 1 - days / maxDateDistance;
      const labelRatio = jaroWinkler(stLine.label, entry.description ?? '');
      const total = Math.round(DATE_WEIGHT * dateScore + LABEL_WEIGHT * labelRatio);
      if (total >= minScore) {
        candidates.push({
          statementLineId: stLine.id,
          journalEntryLineId: entry.id,
          score: total,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const usedStatementLines = new Set<string>();
  const usedEntryLines = new Set<string>();
  const proposals: AutoMatchProposal[] = [];

  for (const c of candidates) {
    if (usedStatementLines.has(c.statementLineId)) continue;
    if (usedEntryLines.has(c.journalEntryLineId)) continue;
    usedStatementLines.add(c.statementLineId);
    usedEntryLines.add(c.journalEntryLineId);
    proposals.push({
      statementLineId: c.statementLineId,
      journalEntryLineId: c.journalEntryLineId,
      confidenceScore: c.score,
    });
  }

  return proposals;
}

/**
 * V2 : retourne des propositions 1:1 ET, si `enableMultiLine`, des
 * propositions 1:N (subset-sum bornée).
 *
 * Garanties :
 *   - Aucune ligne d'écriture n'apparaît dans plus d'une proposition.
 *   - Aucune ligne de relevé n'apparaît dans plus d'une proposition.
 *   - `enableMultiLine=false` (défaut) → comportement strictement
 *     équivalent à `proposeAutoMatches` (rétrocompat).
 */
export function proposeAutoMatchesV2(
  statementLines: ReadonlyArray<AutoMatchInputStatementLine>,
  entryLines: ReadonlyArray<AutoMatchInputEntryLine>,
  options: AutoMatchOptionsV2 = {},
): ReadonlyArray<AutoMatchProposalV2> {
  const enableMultiLine = options.enableMultiLine === true;
  const tolerance = Math.max(0, options.amountTolerance ?? 0);
  const requestedMaxComb = options.maxCombinationSize ?? DEFAULT_MAX_COMBINATION_SIZE;
  const maxCombinationSize = Math.min(Math.max(2, requestedMaxComb), MAX_COMBINATION_HARD_CAP);
  const maxDateDistance = options.maxDateDistanceDays ?? DEFAULT_MAX_DATE_DISTANCE;

  // Étape 1 — réutiliser l'algo 1:1 pour les matches exacts.
  const oneToOne = proposeAutoMatches(statementLines, entryLines, options);

  const usedStatementLines = new Set<string>(oneToOne.map((p) => p.statementLineId));
  const usedEntryLines = new Set<string>(oneToOne.map((p) => p.journalEntryLineId));

  const v2Proposals: AutoMatchProposalV2[] = oneToOne.map((p) => ({
    matchType: '1_to_1' as const,
    statementLineId: p.statementLineId,
    journalEntryLineIds: [p.journalEntryLineId],
    confidenceScore: p.confidenceScore,
  }));

  if (!enableMultiLine || maxCombinationSize < 2) {
    return v2Proposals;
  }

  // Étape 2 — pour chaque ligne de relevé non encore matchée, chercher
  // une combinaison 2..maxCombinationSize de lignes non utilisées dont
  // la somme matche ± tolerance.
  for (const stLine of statementLines) {
    if (usedStatementLines.has(stLine.id)) continue;

    const target = Number(stLine.amount);
    const stDate = stLine.operationDate;

    // Préfiltrer les candidats par proximité de date (fenêtre élargie
    // pour le N:M, car les paiements partiels peuvent être étalés).
    const dateWindow = maxDateDistance * 2;
    const eligible = entryLines
      .filter((e) => !usedEntryLines.has(e.id))
      .map((e) => ({
        id: e.id,
        signedAmount: Number(e.signedAmount),
        description: e.description ?? '',
        days: Math.abs(daysBetween(stDate, e.entryDate)),
      }))
      .filter((e) => e.days <= dateWindow && Number.isFinite(e.signedAmount))
      .sort((a, b) => a.days - b.days);

    if (eligible.length < 2) continue;

    const found = findSubsetSum(eligible, target, tolerance, maxCombinationSize);

    if (found === null) continue;

    // Calcul du score : moyenne pondérée par taille (plus on combine,
    // plus la confiance baisse — heuristique conservatrice).
    const avgDays = found.reduce((acc, idx) => acc + eligible[idx].days, 0) / found.length;
    const dateScore = Math.max(0, 1 - avgDays / dateWindow);
    const labelRatio = found
      .map((idx) => jaroWinkler(stLine.label, eligible[idx].description))
      .reduce((a, b) => Math.max(a, b), 0);
    const sizePenalty = Math.max(0, 1 - (found.length - 2) * 0.05);
    const score = Math.round((DATE_WEIGHT * dateScore + LABEL_WEIGHT * labelRatio) * sizePenalty);

    const entryIds = found.map((idx) => eligible[idx].id);
    entryIds.forEach((id) => usedEntryLines.add(id));
    usedStatementLines.add(stLine.id);

    v2Proposals.push({
      matchType: '1_to_n',
      statementLineId: stLine.id,
      journalEntryLineIds: entryIds,
      confidenceScore: score,
    });
  }

  return v2Proposals;
}

/**
 * Recherche subset-sum bornée. Retourne les indices de la première
 * combinaison trouvée (tailles 2..maxSize) dont la somme ≈ target ±
 * tolerance. Backtracking avec élagage par borne supérieure cumulée.
 *
 * Complexité worst-case O(C(n, maxSize)) — bornée par
 * `MAX_COMBINATION_HARD_CAP` et le préfiltre date.
 */
function findSubsetSum(
  items: ReadonlyArray<{ readonly signedAmount: number }>,
  target: number,
  tolerance: number,
  maxSize: number,
): number[] | null {
  const n = items.length;

  for (let size = 2; size <= Math.min(maxSize, n); size++) {
    const path: number[] = [];
    const result = backtrack(items, target, tolerance, size, 0, 0, path);
    if (result !== null) return result;
  }
  return null;
}

function backtrack(
  items: ReadonlyArray<{ readonly signedAmount: number }>,
  target: number,
  tolerance: number,
  remaining: number,
  start: number,
  currentSum: number,
  path: number[],
): number[] | null {
  if (remaining === 0) {
    if (Math.abs(currentSum - target) <= tolerance + 1e-9) {
      return [...path];
    }
    return null;
  }

  const n = items.length;
  // Élagage : pas assez d'items restants pour compléter.
  if (n - start < remaining) return null;

  for (let i = start; i <= n - remaining; i++) {
    path.push(i);
    const result = backtrack(
      items,
      target,
      tolerance,
      remaining - 1,
      i + 1,
      currentSum + items[i].signedAmount,
      path,
    );
    if (result !== null) return result;
    path.pop();
  }
  return null;
}

function daysBetween(isoA: string, isoB: string): number {
  const a = Date.parse(isoA);
  const b = Date.parse(isoB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

function jaroWinkler(a: string, b: string): number {
  const sa = a.trim().toLowerCase();
  const sb = b.trim().toLowerCase();
  if (sa.length === 0 || sb.length === 0) return 0;
  if (sa === sb) return 1;

  const matchDistance = Math.max(0, Math.floor(Math.max(sa.length, sb.length) / 2) - 1);
  const aMatches = new Array(sa.length).fill(false);
  const bMatches = new Array(sb.length).fill(false);
  let matches = 0;

  for (let i = 0; i < sa.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, sb.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (sa[i] !== sb[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < sa.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (sa[i] !== sb[k]) transpositions++;
    k++;
  }

  const m = matches;
  const jaro = (m / sa.length + m / sb.length + (m - transpositions / 2) / m) / 3;

  let commonPrefix = 0;
  const maxPrefix = Math.min(4, sa.length, sb.length);
  for (let i = 0; i < maxPrefix; i++) {
    if (sa[i] === sb[i]) commonPrefix++;
    else break;
  }
  const winklerBoost = commonPrefix * 0.1 * (1 - jaro);
  return Math.min(1, jaro + winklerBoost);
}
