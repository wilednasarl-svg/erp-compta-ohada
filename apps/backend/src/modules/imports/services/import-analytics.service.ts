import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import { ImportSessionRepository } from '../repositories/import-session.repository';
import { ImportStagingEntryRepository } from '../repositories/import-staging-entry.repository';
import type {
  ImportAnalytics,
  ImportAnalyticsAccountRow,
  ImportAnalyticsClassRow,
  ImportAnalyticsDailyPoint,
  ImportAnalyticsErrorRow,
  ImportAnalyticsJournalRow,
  ImportAnalyticsKpis,
} from '../types/import-analytics';
import type { ValidationError } from '../types/import-status';
import type { MappedRow } from '../types/mapping';

/**
 * `ImportAnalyticsService` — calcule les agrégats analytiques d'une
 * session d'import à partir des staging entries.
 *
 * Cible UI : page `/imports/[sessionId]/dashboard` côté front, avec
 *   - 4 cartes KPI (volumétrie, qualité, équilibre, période),
 *   - courbe journalière débit/crédit (LineChart),
 *   - histogramme par journal (BarChart),
 *   - top 10 comptes par mouvement,
 *   - répartition par classe SYSCOHADA,
 *   - breakdown des codes d'erreurs.
 *
 * Calcul à la volée — pas de table snapshot. Les staging entries
 * sont déjà bornées (< 50k lignes par session) et le repo renvoie
 * uniquement les colonnes JSONB strictement nécessaires.
 *
 * Tenant safety : passe par `ImportStagingEntryRepository.findAllForAnalytics`
 * qui re-vérifie le JOIN sur `import_sessions.organization_id`.
 */
@Injectable()
export class ImportAnalyticsService {
  constructor(
    private readonly sessions: ImportSessionRepository,
    private readonly stagingEntries: ImportStagingEntryRepository,
  ) {}

  async compute(organizationId: TenantId, sessionId: string): Promise<ImportAnalytics> {
    const session = await this.sessions.findById(sessionId, organizationId);
    if (session === null) {
      throw new AppException(ERROR_CODES.IMPORT_SESSION_NOT_FOUND, {
        message: `Import session ${sessionId} not found`,
      });
    }

    const rows = await this.stagingEntries.findAllForAnalytics(sessionId, organizationId);

    const kpis = computeKpis(rows);
    const daily = computeDaily(rows);
    const byJournal = computeByJournal(rows);
    const topAccounts = computeTopAccounts(rows, 10);
    const byAccountClass = computeByAccountClass(rows);
    const errorBreakdown = computeErrorBreakdown(rows);

    return {
      sessionId,
      organizationId,
      currency: 'XOF',
      kpis,
      daily,
      byJournal,
      topAccounts,
      byAccountClass,
      errorBreakdown,
    };
  }
}

// ─── Helpers d'agrégation ────────────────────────────────────────────

type Row = { mappedValues: MappedRow; errors: ValidationError[] };

function parseAmount(value: string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  // Les staging entries normalisent les montants en string, virgule ou point
  // selon le parser source — on accepte les deux.
  const cleaned = value.replace(/\s/g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function computeKpis(rows: ReadonlyArray<Row>): ImportAnalyticsKpis {
  let totalDebit = 0;
  let totalCredit = 0;
  let validLines = 0;
  let errorLines = 0;
  const journals = new Set<string>();
  const accounts = new Set<string>();
  const partners = new Set<string>();
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const r of rows) {
    const debit = parseAmount(r.mappedValues.debit);
    const credit = parseAmount(r.mappedValues.credit);
    totalDebit += debit;
    totalCredit += credit;

    if (r.errors.length === 0) validLines++;
    else errorLines++;

    const j = r.mappedValues.journal;
    if (j !== null && j !== undefined && j !== '') journals.add(j);
    const a = r.mappedValues.account;
    if (a !== null && a !== undefined && a !== '') accounts.add(a);
    const p = r.mappedValues.partner;
    if (p !== null && p !== undefined && p !== '') partners.add(p);

    const d = r.mappedValues.date;
    if (d !== null && d !== undefined && d !== '' && /^\d{4}-\d{2}-\d{2}/.test(d)) {
      const iso = d.slice(0, 10);
      if (minDate === null || iso < minDate) minDate = iso;
      if (maxDate === null || iso > maxDate) maxDate = iso;
    }
  }

  const totalLines = rows.length;
  const netBalance = totalDebit - totalCredit;

  return {
    totalLines,
    validLines,
    errorLines,
    validRatePercent: totalLines === 0 ? 0 : round1((validLines / totalLines) * 100),
    totalDebit: totalDebit.toFixed(2),
    totalCredit: totalCredit.toFixed(2),
    netBalance: netBalance.toFixed(2),
    isBalanced: Math.abs(netBalance) < 0.01,
    periodStart: minDate,
    periodEnd: maxDate,
    distinctJournals: journals.size,
    distinctAccounts: accounts.size,
    distinctPartners: partners.size,
  };
}

function computeDaily(rows: ReadonlyArray<Row>): ImportAnalyticsDailyPoint[] {
  const buckets = new Map<string, { debit: number; credit: number; lines: number }>();
  for (const r of rows) {
    const d = r.mappedValues.date;
    if (d === null || d === undefined || d === '' || !/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
    const key = d.slice(0, 10);
    const existing = buckets.get(key) ?? { debit: 0, credit: 0, lines: 0 };
    existing.debit += parseAmount(r.mappedValues.debit);
    existing.credit += parseAmount(r.mappedValues.credit);
    existing.lines += 1;
    buckets.set(key, existing);
  }
  const points = Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, v]) => ({
      date,
      debit: v.debit.toFixed(2),
      credit: v.credit.toFixed(2),
      net: (v.debit - v.credit).toFixed(2),
      lines: v.lines,
    }));
  return points;
}

function computeByJournal(rows: ReadonlyArray<Row>): ImportAnalyticsJournalRow[] {
  const buckets = new Map<string, { debit: number; credit: number; lines: number }>();
  for (const r of rows) {
    const j = r.mappedValues.journal;
    const key = j === null || j === undefined || j === '' ? '(non renseigné)' : j;
    const existing = buckets.get(key) ?? { debit: 0, credit: 0, lines: 0 };
    existing.debit += parseAmount(r.mappedValues.debit);
    existing.credit += parseAmount(r.mappedValues.credit);
    existing.lines += 1;
    buckets.set(key, existing);
  }
  return Array.from(buckets.entries())
    .map(([journal, v]) => ({
      journal,
      debit: v.debit.toFixed(2),
      credit: v.credit.toFixed(2),
      total: (v.debit + v.credit).toFixed(2),
      lines: v.lines,
    }))
    .sort((a, b) => Number(b.total) - Number(a.total));
}

function computeTopAccounts(rows: ReadonlyArray<Row>, limit: number): ImportAnalyticsAccountRow[] {
  const buckets = new Map<string, { debit: number; credit: number; lines: number }>();
  for (const r of rows) {
    const a = r.mappedValues.account;
    if (a === null || a === undefined || a === '') continue;
    const existing = buckets.get(a) ?? { debit: 0, credit: 0, lines: 0 };
    existing.debit += parseAmount(r.mappedValues.debit);
    existing.credit += parseAmount(r.mappedValues.credit);
    existing.lines += 1;
    buckets.set(a, existing);
  }
  return Array.from(buckets.entries())
    .map(([account, v]) => ({
      account,
      debit: v.debit.toFixed(2),
      credit: v.credit.toFixed(2),
      movement: Math.abs(v.debit - v.credit).toFixed(2),
      lines: v.lines,
    }))
    .sort((a, b) => Number(b.movement) - Number(a.movement))
    .slice(0, limit);
}

const SYSCOHADA_CLASS_LABELS: Record<string, string> = {
  '1': 'Classe 1 — Ressources durables',
  '2': 'Classe 2 — Actif immobilisé',
  '3': 'Classe 3 — Stocks',
  '4': 'Classe 4 — Tiers',
  '5': 'Classe 5 — Trésorerie',
  '6': 'Classe 6 — Charges',
  '7': 'Classe 7 — Produits',
  '8': 'Classe 8 — Autres charges/produits HAO',
  '9': 'Classe 9 — Comptabilité analytique',
};

function computeByAccountClass(rows: ReadonlyArray<Row>): ImportAnalyticsClassRow[] {
  const buckets = new Map<string, { debit: number; credit: number; lines: number }>();
  for (const r of rows) {
    const a = r.mappedValues.account;
    const firstDigit = a !== null && a !== undefined && a.length > 0 ? a[0] : null;
    const key = firstDigit !== null && /^[1-9]$/.test(firstDigit) ? firstDigit : 'autre';
    const existing = buckets.get(key) ?? { debit: 0, credit: 0, lines: 0 };
    existing.debit += parseAmount(r.mappedValues.debit);
    existing.credit += parseAmount(r.mappedValues.credit);
    existing.lines += 1;
    buckets.set(key, existing);
  }
  return Array.from(buckets.entries())
    .map(([accountClass, v]) => ({
      accountClass,
      classLabel: SYSCOHADA_CLASS_LABELS[accountClass] ?? 'Autre / non classé',
      debit: v.debit.toFixed(2),
      credit: v.credit.toFixed(2),
      lines: v.lines,
    }))
    .sort((a, b) => (a.accountClass < b.accountClass ? -1 : 1));
}

function computeErrorBreakdown(rows: ReadonlyArray<Row>): ImportAnalyticsErrorRow[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const e of r.errors) {
      counts.set(e.code, (counts.get(e.code) ?? 0) + 1);
    }
  }
  const total = rows.length;
  return Array.from(counts.entries())
    .map(([code, count]) => ({
      code,
      count,
      sharePercent: total === 0 ? 0 : round1((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
