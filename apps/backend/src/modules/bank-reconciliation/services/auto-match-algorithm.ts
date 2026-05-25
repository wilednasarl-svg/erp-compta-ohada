/**
 * Module 15 — algorithme d'auto-matching ligne relevé ↔ ligne écriture.
 *
 * Pure function. Heuristique wave 1 :
 *
 *   1. Montant exact (signé) : invariant fort.
 *   2. Distance date ≤ 5 jours, score décroît linéairement.
 *   3. Similarité libellé (Jaro-Winkler simplifié).
 *
 * Score final = 80 × score_date_normalisé + 20 × ratio_libellé.
 * 1:1 strict en wave 1 — chaque ligne (relevé ou écriture) ne peut
 * apparaître que dans une seule proposition.
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

export interface AutoMatchProposal {
  readonly statementLineId: string;
  readonly journalEntryLineId: string;
  readonly confidenceScore: number;
}

export interface AutoMatchOptions {
  readonly minScore?: number;
  readonly maxDateDistanceDays?: number;
}

const DEFAULT_MIN_SCORE = 50;
const DEFAULT_MAX_DATE_DISTANCE = 5;
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
