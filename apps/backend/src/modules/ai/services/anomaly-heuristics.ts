import {
  ANOMALY_TYPE_BASE_SCORE,
  DEFAULT_DETECTOR_CONFIG,
  SENSITIVE_ACCOUNT_PREFIXES,
  type AnomalyDetectorConfig,
  type AnomalyType,
} from '../types/ai.types';

/**
 * Pure heuristic engine for Module 11 — no DB, no I/O, fully
 * deterministic. The orchestrator (`AiAnomalyService`) loads data,
 * calls `detectAnomalies(...)`, then persists the findings.
 */

export interface ScannedLine {
  readonly entryId: string;
  readonly entryDate: string; // YYYY-MM-DD
  readonly journalCode: string;
  readonly accountId: string;
  readonly accountCode: string;
  readonly debit: number;
  readonly credit: number;
  readonly description: string | null;
  readonly partner: string | null;
}

export interface Finding {
  readonly entryId: string | null;
  readonly accountId: string | null;
  readonly anomalyType: AnomalyType;
  readonly riskScore: number;
  readonly reasons: string[];
}

export function detectAnomalies(
  lines: ReadonlyArray<ScannedLine>,
  periodStart: string,
  periodEnd: string,
  config: AnomalyDetectorConfig = DEFAULT_DETECTOR_CONFIG,
): Finding[] {
  return [
    ...detectExtremeAmounts(lines, config),
    ...detectSensitiveAccounts(lines),
    ...detectPotentialDuplicates(lines, config),
    ...detectSuspiciousDates(lines, periodStart, periodEnd),
    ...detectRareAccountJournalCombos(lines, config),
  ];
}

function cap(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function totalMovement(line: ScannedLine): number {
  return line.debit + line.credit;
}

function fmtAmount(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n);
}

function startsWithAny(haystack: string, prefixes: ReadonlyArray<string>): string | null {
  for (const p of prefixes) {
    if (haystack.startsWith(p)) return p;
  }
  return null;
}

export function detectExtremeAmounts(
  lines: ReadonlyArray<ScannedLine>,
  config: AnomalyDetectorConfig = DEFAULT_DETECTOR_CONFIG,
): Finding[] {
  const byAccount = new Map<string, ScannedLine[]>();
  for (const line of lines) {
    const arr = byAccount.get(line.accountId);
    if (arr) arr.push(line);
    else byAccount.set(line.accountId, [line]);
  }

  const findings: Finding[] = [];
  for (const [, accountLines] of byAccount) {
    if (accountLines.length < config.extremeAmountMinSample) continue;
    const amounts = accountLines.map(totalMovement).filter((a) => a > 0);
    if (amounts.length < config.extremeAmountMinSample) continue;

    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const variance = amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
    const stddev = Math.sqrt(variance);
    const sorted = [...amounts].sort((a, b) => a - b);
    const median =
      sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

    for (const line of accountLines) {
      const amount = totalMovement(line);
      if (amount <= 0) continue;
      const sigmaDeviation = stddev > 0 ? (amount - mean) / stddev : 0;
      const medianRatio = median > 0 ? amount / median : 0;
      const reasons: string[] = [];
      if (stddev > 0 && sigmaDeviation > config.extremeAmountSigmas) {
        reasons.push(
          `Montant ${fmtAmount(amount)} = ${sigmaDeviation.toFixed(1)}σ au-dessus de la moyenne du compte ${line.accountCode} (n=${amounts.length}).`,
        );
      }
      if (median > 0 && medianRatio > config.extremeAmountMedianMultiplier) {
        reasons.push(
          `Montant ${fmtAmount(amount)} = ${medianRatio.toFixed(1)}× la médiane (${fmtAmount(median)}) du compte ${line.accountCode}.`,
        );
      }
      if (reasons.length === 0) continue;
      const intensity =
        stddev > 0
          ? Math.min(2, sigmaDeviation / config.extremeAmountSigmas)
          : Math.min(2, medianRatio / config.extremeAmountMedianMultiplier);
      findings.push({
        entryId: line.entryId,
        accountId: line.accountId,
        anomalyType: 'extreme_amount',
        riskScore: cap(ANOMALY_TYPE_BASE_SCORE.extreme_amount * intensity),
        reasons,
      });
    }
  }
  return findings;
}

export function detectSensitiveAccounts(lines: ReadonlyArray<ScannedLine>): Finding[] {
  const findings: Finding[] = [];
  for (const line of lines) {
    const prefix = startsWithAny(line.accountCode, SENSITIVE_ACCOUNT_PREFIXES);
    if (!prefix) continue;
    const sample =
      prefix === '57'
        ? 'Caisse — risque détournement, exige rapprochement quotidien'
        : 'Compte hors activité ordinaire — exige justification au CAC';
    findings.push({
      entryId: line.entryId,
      accountId: line.accountId,
      anomalyType: 'sensitive_account',
      riskScore: ANOMALY_TYPE_BASE_SCORE.sensitive_account,
      reasons: [`Compte sensible ${line.accountCode} (préfixe ${prefix}) : ${sample}.`],
    });
  }
  return findings;
}

export function detectPotentialDuplicates(
  lines: ReadonlyArray<ScannedLine>,
  config: AnomalyDetectorConfig = DEFAULT_DETECTOR_CONFIG,
): Finding[] {
  const buckets = new Map<string, ScannedLine[]>();
  for (const line of lines) {
    const amount = totalMovement(line);
    if (amount <= 0) continue;
    const key = `${line.accountCode}|${line.journalCode}|${line.partner ?? ''}|${amount.toFixed(2)}`;
    const arr = buckets.get(key);
    if (arr) arr.push(line);
    else buckets.set(key, [line]);
  }
  const window = config.duplicateWindowDays * 24 * 60 * 60 * 1000;
  const findings: Finding[] = [];
  for (const [, bucket] of buckets) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const tA = Date.parse(a.entryDate);
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        const tB = Date.parse(b.entryDate);
        if (tB - tA > window) break;
        if (a.entryId === b.entryId) continue;
        const reason = `Doublon potentiel : même montant (${fmtAmount(totalMovement(a))}), même compte (${a.accountCode}), même journal (${a.journalCode}), tiers ${a.partner ?? '∅'}, écart de ${Math.round((tB - tA) / 86400000)} j.`;
        findings.push({
          entryId: a.entryId,
          accountId: a.accountId,
          anomalyType: 'potential_duplicate',
          riskScore: ANOMALY_TYPE_BASE_SCORE.potential_duplicate,
          reasons: [reason],
        });
        findings.push({
          entryId: b.entryId,
          accountId: b.accountId,
          anomalyType: 'potential_duplicate',
          riskScore: ANOMALY_TYPE_BASE_SCORE.potential_duplicate,
          reasons: [reason],
        });
      }
    }
  }
  return findings;
}

export function detectSuspiciousDates(
  lines: ReadonlyArray<ScannedLine>,
  periodStart: string,
  periodEnd: string,
): Finding[] {
  const seenEntries = new Set<string>();
  const findings: Finding[] = [];
  for (const line of lines) {
    if (seenEntries.has(line.entryId)) continue;
    const reasons: string[] = [];
    const date = new Date(line.entryDate + 'T00:00:00Z');
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) {
      reasons.push(
        `Écriture datée d'un ${dow === 0 ? 'dimanche' : 'samedi'} (${line.entryDate}).`,
      );
    }
    if (line.entryDate < periodStart || line.entryDate > periodEnd) {
      reasons.push(
        `Date d'écriture ${line.entryDate} hors période fiscale [${periodStart}, ${periodEnd}].`,
      );
    }
    if (reasons.length > 0) {
      seenEntries.add(line.entryId);
      findings.push({
        entryId: line.entryId,
        accountId: null,
        anomalyType: 'suspicious_date',
        riskScore: ANOMALY_TYPE_BASE_SCORE.suspicious_date,
        reasons,
      });
    }
  }
  return findings;
}

export function detectRareAccountJournalCombos(
  lines: ReadonlyArray<ScannedLine>,
  config: AnomalyDetectorConfig = DEFAULT_DETECTOR_CONFIG,
): Finding[] {
  if (lines.length < config.rareCombinationMinSample) return [];
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = `${line.accountCode}|${line.journalCode}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = lines.length;
  const threshold = config.rareCombinationThreshold;
  const findings: Finding[] = [];
  for (const line of lines) {
    const key = `${line.accountCode}|${line.journalCode}`;
    const count = counts.get(key) ?? 0;
    const fraction = count / total;
    if (fraction >= threshold) continue;
    findings.push({
      entryId: line.entryId,
      accountId: line.accountId,
      anomalyType: 'rare_account_journal',
      riskScore: ANOMALY_TYPE_BASE_SCORE.rare_account_journal,
      reasons: [
        `Combinaison compte ${line.accountCode} sur journal ${line.journalCode} très rare : ${count}/${total} écritures (${(fraction * 100).toFixed(2)} %).`,
      ],
    });
  }
  return findings;
}
