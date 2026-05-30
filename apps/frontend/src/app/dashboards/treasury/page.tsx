'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarClock,
  CalendarRange,
  Landmark,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { AppShell } from '@/components/app-shell';
import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces miroir des contrats backend (locales — pas de dépendance partagée)
// ─────────────────────────────────────────────────────────────────────────────

/** GET /organizations/:id/accounting-periods (pour récupérer l'exercice racine). */
interface AccountingPeriodView {
  readonly id: string;
  readonly parentId: string | null;
  readonly startDate: string;
  readonly status: string;
}

interface PeriodsResponse {
  readonly periods: ReadonlyArray<AccountingPeriodView>;
}

/** GET /organizations/:id/dashboards/summary?exerciseId=... — montants DECIMAL string. */
interface DashboardSummary {
  readonly currency: string;
  readonly cashBalance: string;
  readonly receivables: string;
  readonly payables: string;
  readonly netResultYtd: string;
}

/**
 * GET /organizations/:id/bank-accounts.
 * `chartAccountId` relie le compte bancaire à son compte de trésorerie
 * (classe 5) au grand livre : le solde courant réel est lu depuis la
 * balance (trial-balance), `openingBalance` ne servant que de repli.
 */
interface BankAccountResponse {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly bankName: string;
  readonly currency: string;
  readonly chartAccountId: string;
  readonly openingBalance: string;
  readonly status: 'active' | 'closed';
}

interface ListBankAccountsResponse {
  readonly accounts: ReadonlyArray<BankAccountResponse>;
}

/**
 * GET /organizations/:id/reports/trial-balance?fromDate=&toDate=&accountClass=5.
 * Solde courant par compte = endingDebit - endingCredit (classe 5 = débit
 * naturel). Montants DECIMAL string.
 */
interface TrialBalanceRow {
  readonly accountId: string;
  readonly endingDebit: string;
  readonly endingCredit: string;
}

interface TrialBalanceEnvelope {
  readonly report: { readonly rows: ReadonlyArray<TrialBalanceRow> };
}

/** GET /organizations/:id/reports/cash-trend?fromMonth=YYYY-MM&toMonth=YYYY-MM. */
interface CashTrendPoint {
  readonly yearMonth: string;
  readonly netCash: string;
}

interface CashTrendReport {
  readonly points: ReadonlyArray<CashTrendPoint>;
  readonly currentNetCash: string;
  readonly minNetCash: string;
  readonly maxNetCash: string;
}

interface CashTrendEnvelope {
  readonly report: CashTrendReport;
}

/** GET /organizations/:orgId/cash-flow/projection?daysAhead=30|60|90. */
interface CashFlowProjection {
  readonly date: string;
  readonly expectedBalance: string;
  readonly inflows: string;
  readonly outflows: string;
}

interface CashFlowForecastReport {
  readonly currentCashBalance: string;
  readonly projections: ReadonlyArray<CashFlowProjection>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

const PANEL_CLASS = 'rounded-sm border border-line bg-paper';
const PANEL_PADDED = `${PANEL_CLASS} p-5`;
/** Seuil sous lequel un solde bancaire individuel est signalé comme faible. */
const LOW_BANK_BALANCE_THRESHOLD = 0;
/** Horizon (jours) de la projection consommée pour les indicateurs opérationnels. */
const PROJECTION_DAYS = 90;
/** Nombre de mois glissants pour la courbe de trésorerie. */
const TREND_MONTHS = 12;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

function formatShort(val: number): string {
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(0)}k`;
  return val.toFixed(0);
}

/** Décale `date` de `monthsBack` mois et renvoie "YYYY-MM". */
function yearMonthBefore(date: Date, monthsBack: number): string {
  const d = new Date(date.getFullYear(), date.getMonth() - monthsBack, 1);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${month}`;
}

/** Libellé court "janv. 26" pour l'axe X à partir d'un "YYYY-MM". */
function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  if (!year || !month) return yearMonth;
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
}

const STORAGE_PREFIX = 'treasury-min-cash-threshold:';

/** Lecture du seuil persisté en localStorage (gardée SSR). */
function readStoredThreshold(orgId: string): number | null {
  if (typeof window === 'undefined' || orgId === '') return null;
  const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${orgId}`);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `/dashboards/treasury` — cockpit de trésorerie du trésorier.
 *
 * Agrège les données existantes (summary, soldes bancaires, trésorerie
 * glissante, projection) et ajoute des indicateurs opérationnels calculés
 * CÔTÉ CLIENT : jours de cash, alertes de seuil, solde consolidé par banque.
 * Aucun nouvel endpoint backend n'est introduit.
 */
export default function TreasuryDashboardPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  // ── Exercice fiscal racine (pour le summary) ───────────────────────────
  const periodsQuery = useQuery<ReadonlyArray<AccountingPeriodView>, ApiError>({
    queryKey: ['accounting-periods', orgId],
    queryFn: async () => {
      const data = await api.get<PeriodsResponse>(`/organizations/${orgId}/accounting-periods`);
      return data.periods;
    },
    enabled: orgId !== '',
  });

  const exercisePeriod = useMemo(() => {
    const annual = (periodsQuery.data ?? [])
      .filter((p) => p.parentId === null)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
    return annual.find((p) => p.status === 'open') ?? annual[0] ?? null;
  }, [periodsQuery.data]);

  const exerciseId = exercisePeriod?.id ?? null;

  // ── Données existantes ─────────────────────────────────────────────────
  const summaryQuery = useQuery<{ summary: DashboardSummary }, ApiError>({
    queryKey: ['treasury-summary', orgId, exerciseId],
    queryFn: async () =>
      api.get(`/organizations/${orgId}/dashboards/summary?exerciseId=${exerciseId}`),
    enabled: orgId !== '' && exerciseId !== null,
  });

  const banksQuery = useQuery<ListBankAccountsResponse, ApiError>({
    queryKey: ['treasury-bank-accounts', orgId],
    queryFn: async () => api.get(`/organizations/${orgId}/bank-accounts`),
    enabled: orgId !== '',
  });

  // Balance des comptes de trésorerie (classe 5) pour le solde courant réel
  // par banque — snapshot cumulatif de l'ouverture de l'exercice à aujourd'hui.
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const trialBalanceQuery = useQuery<TrialBalanceEnvelope, ApiError>({
    queryKey: ['treasury-trial-balance', orgId, exercisePeriod?.startDate, todayIso],
    queryFn: async () =>
      api.get(
        `/organizations/${orgId}/reports/trial-balance?fromDate=${exercisePeriod?.startDate}&toDate=${todayIso}&accountClass=5`,
      ),
    enabled: orgId !== '' && exercisePeriod !== null,
  });

  const trendRange = useMemo(() => {
    const now = new Date();
    return {
      fromMonth: yearMonthBefore(now, TREND_MONTHS - 1),
      toMonth: yearMonthBefore(now, 0),
    };
  }, []);

  const trendQuery = useQuery<CashTrendEnvelope, ApiError>({
    queryKey: ['treasury-cash-trend', orgId, trendRange.fromMonth, trendRange.toMonth],
    queryFn: async () =>
      api.get(
        `/organizations/${orgId}/reports/cash-trend?fromMonth=${trendRange.fromMonth}&toMonth=${trendRange.toMonth}`,
      ),
    enabled: orgId !== '',
  });

  const projectionQuery = useQuery<CashFlowForecastReport, ApiError>({
    queryKey: ['treasury-projection', orgId, PROJECTION_DAYS],
    queryFn: async () =>
      api.get(`/organizations/${orgId}/cash-flow/projection?daysAhead=${PROJECTION_DAYS}`),
    enabled: orgId !== '',
  });

  const summary = summaryQuery.data?.summary;
  const banks = banksQuery.data?.accounts ?? [];
  const trend = trendQuery.data?.report;
  const projection = projectionQuery.data;

  // Map compte de trésorerie → solde courant (débit - crédit, classe 5 = débit naturel).
  const balanceByAccountId = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of trialBalanceQuery.data?.report.rows ?? []) {
      map.set(r.accountId, Number(r.endingDebit) - Number(r.endingCredit));
    }
    return map;
  }, [trialBalanceQuery.data]);

  // Solde courant réel d'un compte bancaire : grand livre si disponible,
  // sinon repli sur le solde d'ouverture saisi.
  const bankBalance = useMemo(
    () => (b: BankAccountResponse): number =>
      balanceByAccountId.get(b.chartAccountId) ?? Number(b.openingBalance),
    [balanceByAccountId],
  );

  // ── Seuil de trésorerie minimal (état local persisté en localStorage) ──
  const [thresholdInput, setThresholdInput] = useState<string>('');
  const [threshold, setThreshold] = useState<number | null>(null);

  useEffect(() => {
    const stored = readStoredThreshold(orgId);
    setThreshold(stored);
    setThresholdInput(stored === null ? '' : String(stored));
  }, [orgId]);

  const persistThreshold = (value: number | null) => {
    setThreshold(value);
    if (typeof window === 'undefined' || orgId === '') return;
    const key = `${STORAGE_PREFIX}${orgId}`;
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
  };

  // ── Indicateur dérivé : jours de cash ──────────────────────────────────
  // Formule : cash disponible / décaissement journalier moyen.
  // Le décaissement journalier moyen est dérivé de la projection :
  //   somme des `outflows` prévus sur l'horizon / nombre de jours de l'horizon.
  // Si aucune sortie n'est prévue (avgDailyOutflow = 0), l'indicateur n'est
  // pas calculable (autonomie « illimitée » sur la base des prévisions saisies).
  const cashDays = useMemo<number | null>(() => {
    if (!projection) return null;
    const cash = Number(projection.currentCashBalance);
    const projections = projection.projections;
    if (projections.length === 0) return null;
    const totalOutflows = projections.reduce((acc, p) => acc + Number(p.outflows), 0);
    const avgDailyOutflow = totalOutflows / projections.length;
    if (avgDailyOutflow <= 0) return null;
    if (cash <= 0) return 0;
    return Math.floor(cash / avgDailyOutflow);
  }, [projection]);

  // ── Soldes par banque (solde courant grand livre, devise par devise) ──
  const banksByCurrency = useMemo(() => {
    const groups = new Map<string, number>();
    for (const b of banks) {
      groups.set(b.currency, (groups.get(b.currency) ?? 0) + bankBalance(b));
    }
    return groups;
  }, [banks, bankBalance]);

  const banksTotalSameCurrency = useMemo(() => {
    // Total affichable uniquement si toutes les banques partagent la devise.
    if (banksByCurrency.size <= 1) {
      return banks.reduce((acc, b) => acc + bankBalance(b), 0);
    }
    return null;
  }, [banks, banksByCurrency, bankBalance]);

  // ── Alertes de seuil : jours de projection sous le seuil minimal ───────
  const breaches = useMemo(() => {
    if (threshold === null || !projection) return [];
    return projection.projections.filter((p) => Number(p.expectedBalance) < threshold);
  }, [threshold, projection]);

  const firstBreach = breaches[0] ?? null;

  // ── Données du graphique de tendance ───────────────────────────────────
  const trendChartData = useMemo(
    () =>
      (trend?.points ?? []).map((p) => ({
        label: monthLabel(p.yearMonth),
        netCash: Number(p.netCash),
      })),
    [trend],
  );

  // ── Données de la mini-projection (horizons 30/60/90j) ─────────────────
  const projectionHorizons = useMemo(() => {
    if (!projection) return [];
    const findAt = (days: number): number | null => {
      const point = projection.projections[days];
      return point ? Number(point.expectedBalance) : null;
    };
    return [
      { label: '30 jours', value: findAt(30) },
      { label: '60 jours', value: findAt(60) },
      { label: '90 jours', value: findAt(90) },
    ];
  }, [projection]);

  const isLoading =
    periodsQuery.isLoading ||
    summaryQuery.isLoading ||
    banksQuery.isLoading ||
    trendQuery.isLoading ||
    projectionQuery.isLoading;

  const fatalError = banksQuery.error ?? projectionQuery.error ?? trendQuery.error;

  const currency = summary?.currency ?? 'XOF';

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        <header>
          <p className="eyebrow">Pilotage · Trésorerie</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink">
            Trésorerie &amp; Cash
          </h1>
          <p className="mt-2 max-w-[64ch] text-sm text-ink-soft">
            Cockpit du trésorier : cash disponible, soldes bancaires, jours de cash, alertes de
            seuil et projection consolidée.
          </p>
        </header>

        {isLoading && !summary && !projection ? (
          <TreasurySkeleton />
        ) : fatalError ? (
          <div className="rounded-sm border border-critical/40 bg-critical-soft p-4">
            <FormError error={fatalError} />
          </div>
        ) : (
          <>
            {/* ── KPI Row ──────────────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="Cash disponible"
                value={
                  summary ? Number(summary.cashBalance) : Number(projection?.currentCashBalance ?? 0)
                }
                icon={Wallet}
                tone="neutral"
              />
              <KpiCard
                label="Créances clients"
                value={summary ? Number(summary.receivables) : 0}
                icon={TrendingUp}
                tone="positive"
              />
              <KpiCard
                label="Dettes fournisseurs"
                value={summary ? Number(summary.payables) : 0}
                icon={TrendingDown}
                tone="negative"
              />
              <CashDaysCard days={cashDays} />
            </div>

            {/* ── Solde par banque ─────────────────────────────────── */}
            <BankBalancesPanel
              banks={banks}
              balanceOf={bankBalance}
              total={banksTotalSameCurrency}
              multiCurrency={banksByCurrency.size > 1}
            />

            {/* ── Alertes de seuil ─────────────────────────────────── */}
            <ThresholdPanel
              thresholdInput={thresholdInput}
              onInputChange={setThresholdInput}
              onApply={() => {
                const trimmed = thresholdInput.trim();
                if (trimmed === '') {
                  persistThreshold(null);
                  return;
                }
                const parsed = Number(trimmed);
                if (Number.isFinite(parsed)) persistThreshold(parsed);
              }}
              onClear={() => {
                setThresholdInput('');
                persistThreshold(null);
              }}
              threshold={threshold}
              breachesCount={breaches.length}
              firstBreach={firstBreach}
              currency={currency}
              hasProjection={Boolean(projection)}
            />

            {/* ── Tendance de trésorerie 12 mois ───────────────────── */}
            <CashTrendPanel data={trendChartData} />

            {/* ── Projection (mini résumé + lien détail) ───────────── */}
            <ProjectionSummaryPanel
              horizons={projectionHorizons}
              currentBalance={projection ? Number(projection.currentCashBalance) : null}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sous-composants
// ─────────────────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: number;
  icon: typeof Wallet;
  tone: 'positive' | 'negative' | 'neutral';
}

function KpiCard({ label, value, icon: Icon, tone }: KpiCardProps) {
  const color =
    tone === 'positive'
      ? 'text-accent-ink'
      : tone === 'negative'
        ? 'text-critical-ink'
        : 'text-ink';
  const bg =
    tone === 'positive'
      ? 'bg-accent-soft text-accent-ink'
      : tone === 'negative'
        ? 'bg-critical-soft text-critical-ink'
        : 'bg-sunk text-ink-soft';

  return (
    <div className={`${PANEL_PADDED} transition-colors hover:border-line-strong`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-mute">{label}</p>
          <p className={`mt-3 font-mono text-2xl font-semibold tabular-nums ${color}`}>
            {formatAmount(value)}
          </p>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-sm ${bg}`}>
          <Icon className="h-4 w-4" strokeWidth={1.5} />
        </span>
      </div>
    </div>
  );
}

function CashDaysCard({ days }: { days: number | null }) {
  const critical = days !== null && days <= 14;
  const warn = days !== null && days > 14 && days <= 30;
  const bg = critical
    ? 'bg-critical-soft text-critical-ink'
    : warn
      ? 'bg-warn-soft text-warn-ink'
      : 'bg-accent-soft text-accent-ink';
  const color = critical ? 'text-critical-ink' : warn ? 'text-warn-ink' : 'text-ink';

  return (
    <div className={`${PANEL_PADDED} transition-colors hover:border-line-strong`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-mute">
            Jours de cash
          </p>
          <p className={`mt-3 font-mono text-2xl font-semibold tabular-nums ${color}`}>
            {days === null ? 'n/d' : `${days} j`}
          </p>
          <p className="mt-1 text-xs text-ink-mute">cash / décaissement moyen</p>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-sm ${bg}`}>
          <CalendarClock className="h-4 w-4" strokeWidth={1.5} />
        </span>
      </div>
    </div>
  );
}

interface BankBalancesPanelProps {
  banks: ReadonlyArray<BankAccountResponse>;
  balanceOf: (b: BankAccountResponse) => number;
  total: number | null;
  multiCurrency: boolean;
}

function BankBalancesPanel({ banks, balanceOf, total, multiCurrency }: BankBalancesPanelProps) {
  return (
    <section className={PANEL_CLASS}>
      <div className="flex items-center justify-between border-b border-line p-5">
        <div>
          <h2 className="font-display text-xl font-medium text-ink">Solde par banque</h2>
          <p className="mt-1 text-sm text-ink-mute">
            Solde courant par compte bancaire actif, issu du grand livre.
          </p>
        </div>
        <Landmark className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
      </div>

      {banks.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="Aucun compte bancaire"
          description="Créez un compte bancaire pour suivre vos soldes de trésorerie."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-sunk text-xs uppercase tracking-wider text-ink-mute">
                <th className="px-5 py-2 font-medium">Banque</th>
                <th className="px-5 py-2 font-medium">Compte</th>
                <th className="px-5 py-2 font-medium">Devise</th>
                <th className="px-5 py-2 text-right font-medium">Solde</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {banks.map((b) => {
                const balance = balanceOf(b);
                const low = balance < LOW_BANK_BALANCE_THRESHOLD;
                return (
                  <tr key={b.id} className="h-8 transition-colors hover:bg-sunk">
                    <td className="px-5 py-1.5 font-medium text-ink">{b.bankName}</td>
                    <td className="px-5 py-1.5 text-ink-soft">
                      <span className="font-mono text-xs text-ink-mute">{b.code}</span>{' '}
                      {b.label}
                    </td>
                    <td className="px-5 py-1.5 text-ink-soft">{b.currency}</td>
                    <td className="px-5 py-1.5 text-right">
                      <span
                        className={`font-mono tabular-nums ${
                          low ? 'text-critical-ink' : 'text-ink'
                        }`}
                      >
                        {formatAmount(balance)}
                      </span>
                      {low && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-sm bg-critical-soft px-1.5 py-0.5 text-[10px] font-medium text-critical-ink">
                          <AlertTriangle className="h-3 w-3" strokeWidth={1.5} /> faible
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong">
                <td className="px-5 py-2 text-xs font-medium uppercase tracking-wider text-ink-mute" colSpan={3}>
                  Total
                </td>
                <td className="px-5 py-2 text-right font-mono font-semibold tabular-nums text-ink">
                  {total === null ? (
                    <span className="text-xs font-normal text-ink-mute">
                      multidevise &mdash; voir par devise
                    </span>
                  ) : (
                    formatAmount(total)
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
          {multiCurrency && (
            <p className="px-5 py-3 text-xs text-ink-mute">
              {/* Choix délibéré : pas de consolidation FX. Les soldes restent
                  exprimés dans leur devise d'origine, sans conversion au taux
                  du jour, pour éviter d'afficher un total trompeur. */}
              Comptes en plusieurs devises : soldes présentés par devise, sans conversion.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

interface ThresholdPanelProps {
  thresholdInput: string;
  onInputChange: (v: string) => void;
  onApply: () => void;
  onClear: () => void;
  threshold: number | null;
  breachesCount: number;
  firstBreach: CashFlowProjection | null;
  currency: string;
  hasProjection: boolean;
}

function ThresholdPanel({
  thresholdInput,
  onInputChange,
  onApply,
  onClear,
  threshold,
  breachesCount,
  firstBreach,
  currency,
  hasProjection,
}: ThresholdPanelProps) {
  const ok = threshold !== null && breachesCount === 0;
  const breached = threshold !== null && breachesCount > 0;

  return (
    <section className={PANEL_PADDED}>
      <div className="flex flex-col items-start justify-between gap-4 border-b border-line pb-4 md:flex-row md:items-center">
        <div>
          <h2 className="font-display text-xl font-medium text-ink">Alertes de seuil</h2>
          <p className="mt-1 text-sm text-ink-mute">
            Seuil de trésorerie minimal &mdash; configurable et stocké localement dans ce
            navigateur.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-sm bg-sunk px-2 py-0.5 text-xs font-medium text-ink-mute">
          <ShieldCheck className="h-3 w-3" strokeWidth={1.5} /> côté client
        </span>
      </div>

      <div className="flex flex-col gap-4 pt-4 md:flex-row md:items-end">
        <div className="space-y-1.5">
          <label htmlFor="min-cash" className="text-xs font-medium text-ink-mute">
            Seuil minimal ({currency})
          </label>
          <input
            id="min-cash"
            type="number"
            inputMode="numeric"
            value={thresholdInput}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder="Ex : 5000000"
            className="h-9 w-56 rounded-sm border border-line bg-paper px-3 font-mono text-sm text-ink outline-none focus:border-accent"
          />
        </div>
        <button
          type="button"
          onClick={onApply}
          className="press inline-flex h-9 items-center justify-center rounded-sm bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-ink-strong"
        >
          Appliquer
        </button>
        {threshold !== null && (
          <button
            type="button"
            onClick={onClear}
            className="text-sm font-medium text-ink-soft transition-colors hover:text-ink"
          >
            Effacer
          </button>
        )}
      </div>

      <div className="mt-4">
        {threshold === null ? (
          <p className="text-sm text-ink-mute">
            Définissez un seuil pour être alerté lorsque la trésorerie projetée passe en dessous.
          </p>
        ) : !hasProjection ? (
          <p className="text-sm text-ink-mute">Projection indisponible pour évaluer le seuil.</p>
        ) : ok ? (
          <div className="inline-flex items-center gap-2 rounded-sm bg-accent-soft px-3 py-2 text-sm text-accent-ink">
            <ShieldCheck className="h-4 w-4" strokeWidth={1.5} />
            Seuil respecté sur tout l&apos;horizon de projection.
          </div>
        ) : breached ? (
          <div className="space-y-2 rounded-sm bg-critical-soft px-3 py-2 text-sm text-critical-ink">
            <div className="inline-flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" strokeWidth={1.5} />
              {breachesCount} jour{breachesCount > 1 ? 's' : ''} sous le seuil.
            </div>
            {firstBreach && (
              <p className="text-xs">
                Premier dépassement le{' '}
                {new Date(firstBreach.date).toLocaleDateString('fr-FR')} : solde projeté{' '}
                <span className="font-mono">{formatAmount(Number(firstBreach.expectedBalance))}</span>{' '}
                {currency}.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CashTrendPanel({ data }: { data: ReadonlyArray<{ label: string; netCash: number }> }) {
  return (
    <section className={PANEL_PADDED}>
      <div className="mb-6 flex flex-col items-start justify-between gap-4 border-b border-line pb-4 md:flex-row md:items-center">
        <div>
          <h2 className="font-display text-xl font-medium text-ink">Tendance de trésorerie</h2>
          <p className="mt-1 text-sm text-ink-mute">
            Trésorerie nette glissante (classe 5) sur {TREND_MONTHS} mois.
          </p>
        </div>
        <Banknote className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
      </div>

      {data.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title="Aucune donnée de trésorerie"
          description="Les écritures de la classe 5 alimenteront cette courbe une fois saisies."
        />
      ) : (
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data as { label: string; netCash: number }[]} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="treasuryTrend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line)" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'var(--color-ink-mute)' }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'var(--color-ink-mute)' }}
                tickFormatter={(val) => formatShort(Number(val))}
                dx={-10}
              />
              <Tooltip content={<TrendTooltip />} />
              <ReferenceLine y={0} stroke="var(--color-critical)" strokeDasharray="3 3" />
              <Area
                type="monotone"
                dataKey="netCash"
                stroke="var(--color-accent)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#treasuryTrend)"
                animationDuration={500}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

interface TrendTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: { label: string; netCash: number } }>;
}

function TrendTooltip({ active, payload }: TrendTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const data = payload[0]?.payload;
  if (!data) return null;
  const negative = data.netCash < 0;
  return (
    <div className="min-w-[160px] rounded-sm border border-line bg-paper p-3">
      <p className="mb-1.5 text-sm font-medium text-ink">{data.label}</p>
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-mute">Trésorerie nette</span>
        <span className={`font-mono ${negative ? 'text-critical-ink' : 'text-accent-ink'}`}>
          {formatAmount(data.netCash)}
        </span>
      </div>
    </div>
  );
}

interface ProjectionSummaryPanelProps {
  horizons: ReadonlyArray<{ label: string; value: number | null }>;
  currentBalance: number | null;
}

function ProjectionSummaryPanel({ horizons, currentBalance }: ProjectionSummaryPanelProps) {
  return (
    <section className={PANEL_PADDED}>
      <div className="flex flex-col items-start justify-between gap-4 border-b border-line pb-4 md:flex-row md:items-center">
        <div>
          <h2 className="font-display text-xl font-medium text-ink">Projection de trésorerie</h2>
          <p className="mt-1 text-sm text-ink-mute">
            Solde projeté aux horizons clés, à partir des prévisions saisies.
          </p>
        </div>
        <Link
          href="/dashboards/forecast"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-ink transition-colors hover:text-accent"
        >
          Détail des prévisions
          <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-sm border border-line bg-sunk p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-mute">Solde actuel</p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-ink">
            {currentBalance === null ? 'n/d' : formatAmount(currentBalance)}
          </p>
        </div>
        {horizons.map((h) => {
          const negative = h.value !== null && h.value < 0;
          return (
            <div key={h.label} className="rounded-sm border border-line bg-sunk p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-ink-mute">{h.label}</p>
              <p
                className={`mt-2 font-mono text-xl font-semibold tabular-nums ${
                  negative ? 'text-critical-ink' : 'text-ink'
                }`}
              >
                {h.value === null ? 'n/d' : formatAmount(h.value)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface EmptyStateProps {
  icon: typeof Landmark;
  title: string;
  description: string;
}

function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
        <Icon className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
      </span>
      <p className="mt-4 text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-[44ch] text-sm text-ink-mute">{description}</p>
    </div>
  );
}

function TreasurySkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-sm border border-line bg-paper" />
        ))}
      </div>
      <div className="h-64 rounded-sm border border-line bg-paper" />
      <div className="h-40 rounded-sm border border-line bg-paper" />
      <div className="h-[320px] rounded-sm border border-line bg-paper" />
    </div>
  );
}
