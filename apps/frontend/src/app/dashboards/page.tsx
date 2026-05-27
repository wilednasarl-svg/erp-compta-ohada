'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowUp,
  Banknote,
  Coins,
  Loader2,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import type { AccountingPeriodView } from '@/types/journals';
import {
  AGING_BUCKETS,
  AGING_BUCKET_LABELS,
  type AgingType,
  type DashboardAging,
  type DashboardCashflow,
  type DashboardEvolution,
  type DashboardSummary,
  type DashboardTopAccounts,
  type TopAccountCategory,
} from '@/types/dashboards';

interface PeriodsResponse {
  readonly periods: ReadonlyArray<AccountingPeriodView>;
}

const SELECT_CLASS =
  'flex h-9 w-full max-w-md rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors focus:border-accent focus:outline-none';

const PANEL_CLASS = 'rounded-sm border border-line bg-paper p-5';

/**
 * `/dashboards` — Module 19 : overview KPIs + balance âgée + charts.
 */
export default function DashboardsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  const periodsQuery = useQuery<ReadonlyArray<AccountingPeriodView>, ApiError>({
    queryKey: ['accounting-periods', orgId],
    queryFn: async () => {
      const data = await api.get<PeriodsResponse>(
        `/organizations/${orgId}/accounting-periods`,
      );
      return data.periods;
    },
    enabled: orgId !== '',
  });

  const annualPeriods = useMemo(
    () =>
      (periodsQuery.data ?? [])
        .filter((p) => p.parentId === null)
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [periodsQuery.data],
  );

  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);

  const effectiveExerciseId =
    selectedExerciseId ??
    annualPeriods.find((p) => p.status === 'open')?.id ??
    annualPeriods[0]?.id ??
    null;

  return (
    <AppShell>
      <div className="animate-page-in space-y-8">
        <header>
          <p className="eyebrow mb-2">Module 19 · Pilotage</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Dashboards
          </h1>
          <p className="mt-2 text-sm text-ink-mute">
            Vue synthétique de la santé comptable : trésorerie, créances, dettes, résultat
            YTD, balance âgée des tiers.
          </p>
        </header>

        <section className={PANEL_CLASS}>
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Exercice</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Les KPIs et l&apos;aging sont scoped sur cet exercice fiscal.
            </p>
          </div>
          <div className="pt-4">
            {periodsQuery.isLoading ? (
              <p className="text-sm text-ink-mute">Chargement…</p>
            ) : annualPeriods.length === 0 ? (
              <p className="text-sm text-ink-mute">
                Aucun exercice créé.{' '}
                <a className="underline text-accent-ink" href="/accounting-periods">
                  Créer un exercice
                </a>{' '}
                d&apos;abord.
              </p>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="exercise">Exercice fiscal</Label>
                <select
                  id="exercise"
                  value={effectiveExerciseId ?? ''}
                  onChange={(e) => setSelectedExerciseId(e.target.value)}
                  className={SELECT_CLASS}
                >
                  {annualPeriods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.startDate} → {p.endDate}) ·{' '}
                      {p.status === 'open' ? 'Ouvert' : 'Fermé'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <FormError error={periodsQuery.error} className="mt-3" />
          </div>
        </section>

        {effectiveExerciseId && (
          <>
            <SummarySection orgId={orgId} exerciseId={effectiveExerciseId} />
            <CashflowSection orgId={orgId} exerciseId={effectiveExerciseId} />
            <EvolutionSection orgId={orgId} exerciseId={effectiveExerciseId} />
            <TopAccountsSection orgId={orgId} exerciseId={effectiveExerciseId} />
            <AgingSection orgId={orgId} exerciseId={effectiveExerciseId} />
          </>
        )}
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────

function SummarySection({ orgId, exerciseId }: { orgId: string; exerciseId: string }) {
  const summaryQuery = useQuery<{ summary: DashboardSummary }, ApiError>({
    queryKey: ['dashboard-summary', orgId, exerciseId],
    queryFn: async () =>
      api.get(`/organizations/${orgId}/dashboards/summary?exerciseId=${exerciseId}`),
  });

  if (summaryQuery.isLoading) {
    return (
      <section className={PANEL_CLASS}>
        <p className="text-sm text-ink-mute">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Chargement du summary…
        </p>
      </section>
    );
  }

  if (summaryQuery.error) {
    return (
      <section className={PANEL_CLASS}>
        <FormError error={summaryQuery.error} />
      </section>
    );
  }

  const s = summaryQuery.data?.summary;
  if (!s) return null;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Trésorerie"
          value={s.cashBalance}
          currency={s.currency}
          icon={Banknote}
          tone="positive"
        />
        <KpiCard
          label="Créances clients"
          value={s.receivables}
          currency={s.currency}
          icon={Users}
          tone="neutral"
        />
        <KpiCard
          label="Dettes fournisseurs"
          value={s.payables}
          currency={s.currency}
          icon={Coins}
          tone="neutral"
        />
        <KpiCard
          label="Résultat YTD"
          value={s.netResultYtd}
          currency={s.currency}
          icon={TrendingUp}
          tone="signed"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className={PANEL_CLASS}>
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">
              Produits / Charges YTD
            </h2>
            <p className="mt-1 text-sm text-ink-mute">
              Période {s.periodStart} → {s.periodEnd}
            </p>
          </div>
          <div className="space-y-3 pt-4">
            <Row label="Produits" value={s.revenueYtd} currency={s.currency} tone="positive" />
            <Row label="Charges" value={s.expensesYtd} currency={s.currency} tone="negative" />
            <div className="border-t border-line pt-2">
              <Row
                label="Résultat net"
                value={s.netResultYtd}
                currency={s.currency}
                tone="signed"
                bold
              />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <RatioCard label="Marge brute" value={s.grossMarginRatio} format="percent" />
              <RatioCard label="Liquidité" value={s.liquidityRatio} format="multiple" />
            </div>
          </div>
        </section>

        <section className={PANEL_CLASS}>
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">
              Répartition par classe OHADA
            </h2>
            <p className="mt-1 text-sm text-ink-mute">
              Mouvements de l&apos;exercice (signed net)
            </p>
          </div>
          <div className="pt-4">
            {s.accountClassBreakdown.length === 0 ? (
              <p className="text-sm text-ink-mute">
                Aucune écriture validée sur cet exercice.
              </p>
            ) : (
              <ClassBreakdownChart breakdown={s.accountClassBreakdown} />
            )}
          </div>
        </section>
      </div>
    </>
  );
}

interface KpiCardProps {
  readonly label: string;
  readonly value: string;
  readonly currency: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly tone: 'positive' | 'negative' | 'neutral' | 'signed';
}

function KpiCard({ label, value, currency, icon: Icon, tone }: KpiCardProps) {
  const num = Number(value);
  const color =
    tone === 'positive'
      ? 'text-accent-ink'
      : tone === 'negative'
        ? 'text-critical-ink'
        : tone === 'signed'
          ? num >= 0
            ? 'text-accent-ink'
            : 'text-critical-ink'
          : 'text-ink';
  return (
    <div className="rounded-sm border border-line bg-paper p-5">
      <div className="flex items-center justify-between text-sm text-ink-mute">
        <span>{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <div className={`mt-2 font-mono text-2xl font-semibold ${color}`}>
        {formatAmount(num)}
      </div>
      <div className="text-xs text-ink-mute">{currency}</div>
    </div>
  );
}

function Row({
  label,
  value,
  currency,
  tone,
  bold,
}: {
  label: string;
  value: string;
  currency: string;
  tone: 'positive' | 'negative' | 'neutral' | 'signed';
  bold?: boolean;
}) {
  const num = Number(value);
  const color =
    tone === 'positive'
      ? 'text-accent-ink'
      : tone === 'negative'
        ? 'text-critical-ink'
        : tone === 'signed'
          ? num >= 0
            ? 'text-accent-ink'
            : 'text-critical-ink'
          : 'text-ink';
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className={bold ? 'font-medium text-ink' : 'text-ink-mute'}>{label}</span>
      <span className={`font-mono ${color} ${bold ? 'font-semibold' : ''}`}>
        {formatAmount(num)} <span className="text-xs">{currency}</span>
      </span>
    </div>
  );
}

function RatioCard({
  label,
  value,
  format,
}: {
  label: string;
  value: number | null;
  format: 'percent' | 'multiple';
}) {
  return (
    <div className="rounded-sm border border-line bg-sunk/30 px-3 py-2">
      <div className="text-xs text-ink-mute">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-medium text-ink">
        {value === null ? (
          <span className="text-ink-mute">N/A</span>
        ) : format === 'percent' ? (
          `${(value * 100).toFixed(1)} %`
        ) : (
          `${value.toFixed(2)}x`
        )}
      </div>
    </div>
  );
}

function ClassBreakdownChart({
  breakdown,
}: {
  breakdown: ReadonlyArray<{
    accountClass: number;
    label: string;
    net: string;
  }>;
}) {
  const maxAbs = Math.max(...breakdown.map((b) => Math.abs(Number(b.net))), 1);

  return (
    <ul className="space-y-2 text-sm">
      {breakdown.map((b) => {
        const num = Number(b.net);
        const pct = (Math.abs(num) / maxAbs) * 100;
        const positive = num >= 0;
        return (
          <li key={b.accountClass} className="space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-ink">
                <span className="font-mono text-xs text-ink-mute">
                  Cl.{b.accountClass}
                </span>{' '}
                {b.label}
              </span>
              <span
                className={`font-mono text-xs ${
                  positive ? 'text-accent-ink' : 'text-critical-ink'
                }`}
              >
                {positive ? '+' : ''}
                {formatAmount(num)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-sunk">
              <div
                className={positive ? 'h-full bg-accent' : 'h-full bg-critical'}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────
// AGING
// ─────────────────────────────────────────────────────────────────────

function AgingSection({ orgId, exerciseId }: { orgId: string; exerciseId: string }) {
  const [type, setType] = useState<AgingType>('clients');

  const agingQuery = useQuery<{ aging: DashboardAging }, ApiError>({
    queryKey: ['dashboard-aging', orgId, exerciseId, type],
    queryFn: async () =>
      api.get(
        `/organizations/${orgId}/dashboards/aging?exerciseId=${exerciseId}&type=${type}`,
      ),
  });

  const aging = agingQuery.data?.aging;

  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-line pb-3">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-xl font-medium text-ink">Balance âgée</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Soldes non lettrés par bucket d&apos;ancienneté ·{' '}
              {aging ? `arrêté au ${aging.asOfDate}` : '…'}
            </p>
          </div>
          <div className="flex gap-1 rounded-sm border border-line bg-sunk/30 p-0.5">
            <Button
              type="button"
              size="sm"
              variant={type === 'clients' ? 'default' : 'outline'}
              onClick={() => setType('clients')}
              className={`press ${type === 'clients' ? '' : 'border-0 bg-transparent'}`}
            >
              Clients
            </Button>
            <Button
              type="button"
              size="sm"
              variant={type === 'fournisseurs' ? 'default' : 'outline'}
              onClick={() => setType('fournisseurs')}
              className={`press ${type === 'fournisseurs' ? '' : 'border-0 bg-transparent'}`}
            >
              Fournisseurs
            </Button>
          </div>
        </div>
      </div>
      <div className="space-y-4 pt-4">
        {agingQuery.isLoading ? (
          <p className="text-sm text-ink-mute">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Chargement…
          </p>
        ) : agingQuery.error ? (
          <FormError error={agingQuery.error} />
        ) : !aging ? null : aging.partnerBreakdown.length === 0 ? (
          <p className="text-sm text-ink-mute">
            Aucun encours {type === 'clients' ? 'client' : 'fournisseur'} sur cet exercice.
          </p>
        ) : (
          <>
            <BucketBars buckets={aging.buckets} currency={aging.currency} />
            <div className="flex items-baseline justify-between border-t border-line pt-3 text-sm">
              <span className="font-medium text-ink">Total encours</span>
              <span className="font-mono text-lg font-semibold text-ink">
                {formatAmount(Number(aging.totalOutstanding))}{' '}
                <span className="text-xs text-ink-mute">{aging.currency}</span>
              </span>
            </div>
            <PartnerAgingTable
              partners={aging.partnerBreakdown}
              currency={aging.currency}
            />
          </>
        )}
      </div>
    </section>
  );
}

function BucketBars({
  buckets,
  currency,
}: {
  buckets: ReadonlyArray<{ bucket: string; amount: string; lineCount: number }>;
  currency: string;
}) {
  const maxAmount = Math.max(...buckets.map((b) => Number(b.amount)), 1);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      {AGING_BUCKETS.map((b) => {
        const bucket = buckets.find((x) => x.bucket === b);
        const amount = bucket ? Number(bucket.amount) : 0;
        const pct = (amount / maxAmount) * 100;
        const isOver = b === 'over-90';
        return (
          <div
            key={b}
            className={`rounded-sm border p-3 ${
              isOver && amount > 0
                ? 'border-critical/50 bg-critical-soft'
                : 'border-line bg-paper'
            }`}
          >
            <div className="text-xs text-ink-mute">{AGING_BUCKET_LABELS[b]}</div>
            <div
              className={`mt-1 font-mono text-lg font-semibold ${
                isOver && amount > 0 ? 'text-critical-ink' : 'text-ink'
              }`}
            >
              {formatAmount(amount)}
            </div>
            <div className="text-xs text-ink-mute">
              {bucket?.lineCount ?? 0} ligne(s) · {currency}
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-sunk">
              <div
                className={isOver ? 'h-full bg-critical' : 'h-full bg-accent'}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PartnerAgingTable({
  partners,
  currency,
}: {
  partners: ReadonlyArray<{
    accountId: string;
    accountCode: string;
    accountLabel: string;
    totalOutstanding: string;
    amountsByBucket: Record<string, string>;
  }>;
  currency: string;
}) {
  return (
    <div className="overflow-x-auto rounded-sm border border-line">
      <table className="w-full text-sm">
        <thead className="bg-sunk">
          <tr>
            <th className="px-3 py-2 text-left">
              <span className="eyebrow">Compte</span>
            </th>
            <th className="px-3 py-2 text-left">
              <span className="eyebrow">Libellé</span>
            </th>
            {AGING_BUCKETS.map((b) => (
              <th key={b} className="px-3 py-2 text-right">
                <span className="eyebrow">{AGING_BUCKET_LABELS[b]}</span>
              </th>
            ))}
            <th className="px-3 py-2 text-right">
              <span className="eyebrow">Total</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {partners.slice(0, 100).map((p, idx) => {
            const over = Number(p.amountsByBucket['over-90']);
            return (
              <tr
                key={p.accountId}
                className={`border-t border-line ${idx % 2 === 1 ? 'bg-sunk/30' : ''}`}
              >
                <td className="px-3 py-2 font-mono text-xs text-ink">{p.accountCode}</td>
                <td className="px-3 py-2 text-ink">{p.accountLabel}</td>
                {AGING_BUCKETS.map((b) => {
                  const v = Number(p.amountsByBucket[b]);
                  return (
                    <td
                      key={b}
                      className={`px-3 py-2 text-right font-mono ${
                        b === 'over-90' && v > 0
                          ? 'font-medium text-critical-ink'
                          : v === 0
                            ? 'text-ink-mute'
                            : 'text-ink'
                      }`}
                    >
                      {v === 0 ? '—' : formatAmount(v)}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right font-mono font-medium text-ink">
                  {formatAmount(Number(p.totalOutstanding))}
                  {over > 0 && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-critical-soft px-1.5 py-0 text-[10px] font-medium text-critical-ink">
                      <ArrowUp className="mr-0.5 inline h-2 w-2" /> 90j+
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t border-line bg-sunk/40 text-sm font-medium text-ink">
          <tr>
            <td className="px-3 py-2" colSpan={2}>
              Total ({partners.length} partenaire(s))
            </td>
            {AGING_BUCKETS.map((b) => {
              const total = partners.reduce(
                (sum, p) => sum + Number(p.amountsByBucket[b]),
                0,
              );
              return (
                <td key={b} className="px-3 py-2 text-right font-mono">
                  {formatAmount(total)}
                </td>
              );
            })}
            <td className="px-3 py-2 text-right font-mono">
              {formatAmount(
                partners.reduce((sum, p) => sum + Number(p.totalOutstanding), 0),
              )}{' '}
              <span className="text-xs text-ink-mute">{currency}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CASHFLOW (AreaChart)
// ─────────────────────────────────────────────────────────────────────

// Chart palette aligned with token system (OKLCH→hex approximations).
const CHART_ACCENT = '#3f8a52';   // accent green
const CHART_CRITICAL = '#b3441f'; // critical red
const CHART_INFO = '#3c5d99';     // info blue
const CHART_WARN = '#c08329';     // warn ochre
const CHART_GRID = '#e7e3dc';     // line
const CHART_INK_SOFT = '#5c5c66'; // ink-soft

function CashflowSection({ orgId, exerciseId }: { orgId: string; exerciseId: string }) {
  const cashflowQuery = useQuery<{ cashflow: DashboardCashflow }, ApiError>({
    queryKey: ['dashboard-cashflow', orgId, exerciseId],
    queryFn: async () =>
      api.get(`/organizations/${orgId}/dashboards/cashflow?exerciseId=${exerciseId}`),
  });

  const c = cashflowQuery.data?.cashflow;
  const points = useMemo(
    () =>
      (c?.points ?? []).map((p) => ({
        label: p.label,
        inflow: Number(p.inflow),
        outflow: Number(p.outflow),
        netFlow: Number(p.netFlow),
        closingBalance: Number(p.closingBalance),
      })),
    [c],
  );

  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-line pb-3">
        <h2 className="font-display text-xl font-medium text-ink">Flux de trésorerie</h2>
        <p className="mt-1 text-sm text-ink-mute">
          Encaissements / décaissements mensuels et solde de trésorerie cumulé
        </p>
      </div>
      <div className="pt-4">
        {cashflowQuery.isLoading ? (
          <p className="text-sm text-ink-mute">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Chargement…
          </p>
        ) : cashflowQuery.error ? (
          <FormError error={cashflowQuery.error} />
        ) : points.length === 0 ? (
          <p className="text-sm text-ink-mute">
            Aucun mouvement sur les comptes de trésorerie pour cet exercice.
          </p>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
              <MiniStat label="Total encaissements" value={Number(c?.totals.inflow ?? 0)} tone="positive" currency={c?.currency} />
              <MiniStat label="Total décaissements" value={Number(c?.totals.outflow ?? 0)} tone="negative" currency={c?.currency} />
              <MiniStat label="Net" value={Number(c?.totals.netFlow ?? 0)} tone="signed" currency={c?.currency} />
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradClosing" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_ACCENT} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={CHART_ACCENT} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_INK_SOFT }} />
                  <YAxis tick={{ fontSize: 11, fill: CHART_INK_SOFT }} tickFormatter={shortNumber} />
                  <Tooltip formatter={(v) => formatAmount(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="closingBalance"
                    name="Solde cumulé"
                    stroke={CHART_ACCENT}
                    fill="url(#gradClosing)"
                    strokeWidth={2}
                  />
                  <Line type="monotone" dataKey="inflow" name="Encaissements" stroke={CHART_INFO} dot={false} />
                  <Line type="monotone" dataKey="outflow" name="Décaissements" stroke={CHART_CRITICAL} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// EVOLUTION P&L
// ─────────────────────────────────────────────────────────────────────

function EvolutionSection({ orgId, exerciseId }: { orgId: string; exerciseId: string }) {
  const evolutionQuery = useQuery<{ evolution: DashboardEvolution }, ApiError>({
    queryKey: ['dashboard-evolution', orgId, exerciseId],
    queryFn: async () =>
      api.get(`/organizations/${orgId}/dashboards/evolution?exerciseId=${exerciseId}`),
  });

  const e = evolutionQuery.data?.evolution;
  const points = useMemo(
    () =>
      (e?.points ?? []).map((p) => ({
        label: p.label,
        revenue: Number(p.revenue),
        expenses: Number(p.expenses),
        netResult: Number(p.netResult),
      })),
    [e],
  );

  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-line pb-3">
        <h2 className="font-display text-xl font-medium text-ink">
          Évolution Produits / Charges
        </h2>
        <p className="mt-1 text-sm text-ink-mute">
          Barres mensuelles + courbe du résultat net
        </p>
      </div>
      <div className="pt-4">
        {evolutionQuery.isLoading ? (
          <p className="text-sm text-ink-mute">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Chargement…
          </p>
        ) : evolutionQuery.error ? (
          <FormError error={evolutionQuery.error} />
        ) : points.length === 0 ? (
          <p className="text-sm text-ink-mute">
            Aucun produit/charge sur cet exercice.
          </p>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
              <MiniStat label="Produits totaux" value={Number(e?.totals.revenue ?? 0)} tone="positive" currency={e?.currency} />
              <MiniStat label="Charges totales" value={Number(e?.totals.expenses ?? 0)} tone="negative" currency={e?.currency} />
              <MiniStat label="Résultat net" value={Number(e?.totals.netResult ?? 0)} tone="signed" currency={e?.currency} />
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={points} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_INK_SOFT }} />
                  <YAxis tick={{ fontSize: 11, fill: CHART_INK_SOFT }} tickFormatter={shortNumber} />
                  <Tooltip formatter={(v) => formatAmount(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="revenue" name="Produits" fill={CHART_ACCENT} />
                  <Bar dataKey="expenses" name="Charges" fill={CHART_CRITICAL} />
                  <Line type="monotone" dataKey="netResult" name="Résultat" stroke={CHART_INFO} strokeWidth={2} dot={{ r: 3 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TOP ACCOUNTS (PieChart)
// ─────────────────────────────────────────────────────────────────────

// Editorial palette tied to OKLCH tokens — restrained, alternates ink/accent tones.
const PIE_COLORS = [
  '#3f8a52', // accent
  '#3c5d99', // info
  '#c08329', // warn
  '#b3441f', // critical
  '#5c5c66', // ink-soft
  '#6b9c7c', // accent muted
  '#7a8baf', // info muted
  '#a78c5e', // warn muted
  '#b87a5e', // critical muted
  '#8a8a96', // ink-mute
];

function TopAccountsSection({ orgId, exerciseId }: { orgId: string; exerciseId: string }) {
  const [category, setCategory] = useState<TopAccountCategory>('expenses');

  const topQuery = useQuery<{ topAccounts: DashboardTopAccounts }, ApiError>({
    queryKey: ['dashboard-top-accounts', orgId, exerciseId, category],
    queryFn: async () =>
      api.get(
        `/organizations/${orgId}/dashboards/top-accounts?exerciseId=${exerciseId}&category=${category}&limit=10`,
      ),
  });

  const top = topQuery.data?.topAccounts;
  const pieData = useMemo(
    () =>
      (top?.rows ?? []).map((r) => ({
        name: `${r.accountCode} ${r.accountLabel}`,
        value: Number(r.amount),
        sharePercent: r.sharePercent,
      })),
    [top],
  );

  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-line pb-3">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-xl font-medium text-ink">Top comptes</h2>
            <p className="mt-1 text-sm text-ink-mute">
              {category === 'expenses' ? 'Top 10 charges' : 'Top 10 produits'} de l&apos;exercice
            </p>
          </div>
          <div className="flex gap-1 rounded-sm border border-line bg-sunk/30 p-0.5">
            <Button
              type="button"
              size="sm"
              variant={category === 'expenses' ? 'default' : 'outline'}
              onClick={() => setCategory('expenses')}
              className={`press ${category === 'expenses' ? '' : 'border-0 bg-transparent'}`}
            >
              Charges
            </Button>
            <Button
              type="button"
              size="sm"
              variant={category === 'revenue' ? 'default' : 'outline'}
              onClick={() => setCategory('revenue')}
              className={`press ${category === 'revenue' ? '' : 'border-0 bg-transparent'}`}
            >
              Produits
            </Button>
          </div>
        </div>
      </div>
      <div className="pt-4">
        {topQuery.isLoading ? (
          <p className="text-sm text-ink-mute">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Chargement…
          </p>
        ) : topQuery.error ? (
          <FormError error={topQuery.error} />
        ) : pieData.length === 0 ? (
          <p className="text-sm text-ink-mute">
            Aucune écriture sur cette catégorie pour l&apos;exercice.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.2fr]">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={(p) => {
                      const entry = pieData[(p as unknown as { index: number }).index];
                      return entry ? `${entry.sharePercent}%` : '';
                    }}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatAmount(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto rounded-sm border border-line">
              <table className="w-full text-sm">
                <thead className="bg-sunk">
                  <tr>
                    <th className="px-3 py-2 text-left">
                      <span className="eyebrow">Compte</span>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <span className="eyebrow">Montant</span>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <span className="eyebrow">Part</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(top?.rows ?? []).map((r, i) => (
                    <tr
                      key={r.accountId}
                      className={`border-t border-line ${i % 2 === 1 ? 'bg-sunk/30' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                          />
                          <span className="font-mono text-xs text-ink">{r.accountCode}</span>
                          <span className="truncate text-ink">{r.accountLabel}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-ink">{formatAmount(Number(r.amount))}</td>
                      <td className="px-3 py-2 text-right text-xs text-ink-mute">{r.sharePercent}%</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-line bg-sunk/40 text-sm font-medium text-ink">
                  <tr>
                    <td className="px-3 py-2">Total catégorie</td>
                    <td className="px-3 py-2 text-right font-mono">{formatAmount(Number(top?.totalAmount ?? 0))}</td>
                    <td className="px-3 py-2 text-right text-ink-mute">{top?.currency}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function MiniStat({
  label,
  value,
  tone,
  currency,
}: {
  label: string;
  value: number;
  tone: 'positive' | 'negative' | 'signed';
  currency?: string;
}) {
  const color =
    tone === 'positive'
      ? 'text-accent-ink'
      : tone === 'negative'
        ? 'text-critical-ink'
        : value >= 0
          ? 'text-accent-ink'
          : 'text-critical-ink';
  return (
    <div className="rounded-sm border border-line bg-sunk/20 px-3 py-2">
      <div className="text-xs text-ink-mute">{label}</div>
      <div className={`font-mono text-sm font-semibold ${color}`}>
        {formatAmount(value)} {currency && <span className="text-xs">{currency}</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return n.toFixed(0);
}
