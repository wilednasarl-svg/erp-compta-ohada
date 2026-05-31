'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowUp,
  BarChart3,
  Banknote,
  CalendarRange,
  Coins,
  Inbox,
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
import { FormError } from '@/components/ui/form-error';
import { Hint } from '@/components/ui/hint';
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

const PANEL_CLASS = 'rounded-sm border border-line bg-paper';
const PANEL_PADDED = `${PANEL_CLASS} p-5`;

/**
 * `/dashboards` — KPIs détaillés par exercice (trésorerie, P&L, balance âgée).
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
          <p className="eyebrow">Pilotage · KPIs</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink">
            Tableaux de bord
          </h1>
          <p className="mt-2 max-w-[64ch] text-sm text-ink-soft">
            Trésorerie, créances, dettes, résultat YTD et balance âgée des tiers, scopés
            sur l'exercice fiscal sélectionné.
          </p>
        </header>

        <Hint id="dashboards-overview" variant="learn">
          Commencez par choisir un exercice ci-dessous : tous les indicateurs (trésorerie,
          résultat, balance âgée) sont recalculés pour cet exercice uniquement.
        </Hint>

        {/* ── Period selector ──────────────────────────────────── */}
        <section className={PANEL_PADDED}>
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-3">
            <div>
              <h2 className="font-display text-xl font-medium text-ink">Exercice fiscal</h2>
              <p className="mt-1 text-sm text-ink-mute">
                Les KPIs ci-dessous sont scopés sur l'exercice sélectionné.
              </p>
            </div>
            <CalendarRange className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
          </div>
          <div className="pt-4">
            {periodsQuery.isLoading ? (
              <PeriodSelectorSkeleton />
            ) : annualPeriods.length === 0 ? (
              <EmptyState
                icon={CalendarRange}
                title="Aucun exercice créé"
                description="Créez un exercice fiscal pour consulter les KPIs et la balance âgée."
                actionLabel="Créer un exercice"
                actionHref="/accounting-periods"
              />
            ) : (
              <PeriodTabs
                periods={annualPeriods}
                activeId={effectiveExerciseId}
                onChange={setSelectedExerciseId}
              />
            )}
            <FormError error={periodsQuery.error} className="mt-3" />
          </div>
        </section>

        {effectiveExerciseId !== null && (
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
// PERIOD SELECTOR
// ─────────────────────────────────────────────────────────────────────

interface PeriodTabsProps {
  readonly periods: ReadonlyArray<AccountingPeriodView>;
  readonly activeId: string | null;
  readonly onChange: (id: string) => void;
}

function PeriodTabs({ periods, activeId, onChange }: PeriodTabsProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {periods.map((p) => {
        const isActive = p.id === activeId;
        const isOpen = p.status === 'open';
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            className={`press group flex items-center gap-2 rounded-sm border px-3 py-2 text-left transition-colors duration-fast ${
              isActive
                ? 'border-ink bg-ink text-canvas'
                : 'border-line bg-paper text-ink hover:bg-sunk'
            }`}
          >
            <span className="flex flex-col">
              <span className="text-sm font-medium leading-tight">{p.label}</span>
              <span
                className={`mt-0.5 font-mono text-2xs tabular-nums ${
                  isActive ? 'text-canvas/70' : 'text-ink-mute'
                }`}
              >
                {p.startDate} → {p.endDate}
              </span>
            </span>
            <span
              className={`ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium ${
                isActive
                  ? 'bg-canvas/15 text-canvas'
                  : isOpen
                    ? 'bg-accent-soft text-accent-ink'
                    : 'bg-sunk text-ink-soft'
              }`}
            >
              {isOpen ? 'Ouvert' : 'Fermé'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PeriodSelectorSkeleton() {
  return (
    <div className="flex animate-pulse flex-wrap gap-1.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-12 w-44 rounded-sm bg-sunk" />
      ))}
    </div>
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
    return <KpiSkeletonGrid />;
  }

  if (summaryQuery.error) {
    return (
      <section className={PANEL_PADDED}>
        <FormError error={summaryQuery.error} />
      </section>
    );
  }

  const s = summaryQuery.data?.summary;
  if (!s) return null;

  return (
    <>
      <div className="reveal-stagger grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
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
        <section className={PANEL_PADDED}>
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">
              Produits / Charges YTD
            </h2>
            <p className="mt-1 text-sm text-ink-mute">
              Période <span className="font-mono tabular-nums">{s.periodStart}</span> →{' '}
              <span className="font-mono tabular-nums">{s.periodEnd}</span>
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

        <section className={PANEL_PADDED}>
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">
              Répartition par classe OHADA
            </h2>
            <p className="mt-1 text-sm text-ink-mute">
              Mouvements de l'exercice (net signé)
            </p>
          </div>
          <div className="pt-4">
            {s.accountClassBreakdown.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="Aucune écriture validée"
                description="Validez des écritures pour voir la répartition par classe."
              />
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
  readonly icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
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
    <div className="rounded-sm border border-line bg-paper p-5 transition-colors duration-fast hover:border-line-strong">
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-ink-mute">
        <span>{label}</span>
        <Icon className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <div className={`mt-3 font-mono text-2xl font-semibold tabular-nums ${color}`}>
        {formatAmount(num)}
      </div>
      <div className="mt-0.5 text-xs text-ink-mute">{currency}</div>
    </div>
  );
}

function KpiSkeletonGrid() {
  return (
    <div className="grid animate-pulse grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-sm border border-line bg-paper p-5">
          <div className="flex items-center justify-between">
            <div className="h-3 w-24 rounded-xs bg-sunk" />
            <div className="h-4 w-4 rounded-xs bg-sunk" />
          </div>
          <div className="mt-3 h-7 w-32 rounded-xs bg-sunk" />
          <div className="mt-1 h-3 w-10 rounded-xs bg-sunk" />
        </div>
      ))}
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
      <span className={bold ? 'font-medium text-ink' : 'text-ink-soft'}>{label}</span>
      <span className={`font-mono tabular-nums ${color} ${bold ? 'font-semibold' : ''}`}>
        {formatAmount(num)} <span className="text-xs text-ink-mute">{currency}</span>
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
    <div className="rounded-sm bg-sunk px-3 py-2">
      <div className="text-xs text-ink-mute">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-medium tabular-nums text-ink">
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
                <span className="font-mono text-xs text-ink-mute tabular-nums">
                  Cl.{b.accountClass}
                </span>{' '}
                {b.label}
              </span>
              <span
                className={`font-mono text-xs tabular-nums ${
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
    <section className={PANEL_PADDED}>
      <div className="border-b border-line pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-medium text-ink">Balance âgée</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Soldes non lettrés par bucket d'ancienneté ·{' '}
              {aging ? (
                <>
                  arrêté au{' '}
                  <span className="font-mono tabular-nums">{aging.asOfDate}</span>
                </>
              ) : (
                '…'
              )}
            </p>
          </div>
          <SegmentedControl
            options={[
              { value: 'clients', label: 'Clients' },
              { value: 'fournisseurs', label: 'Fournisseurs' },
            ]}
            value={type}
            onChange={(v) => setType(v as AgingType)}
          />
        </div>
      </div>
      <div className="space-y-4 pt-4">
        {agingQuery.isLoading ? (
          <AgingSkeleton />
        ) : agingQuery.error ? (
          <FormError error={agingQuery.error} />
        ) : !aging ? null : aging.partnerBreakdown.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={`Aucun encours ${type === 'clients' ? 'client' : 'fournisseur'}`}
            description="Tous les comptes auxiliaires sont lettrés sur cet exercice."
          />
        ) : (
          <>
            <BucketBars buckets={aging.buckets} currency={aging.currency} />
            <div className="flex items-baseline justify-between border-t border-line pt-3 text-sm">
              <span className="font-medium text-ink">Total encours</span>
              <span className="font-mono text-lg font-semibold tabular-nums text-ink">
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

function AgingSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-sm border border-line bg-paper p-3">
            <div className="h-3 w-16 rounded-xs bg-sunk" />
            <div className="mt-2 h-5 w-24 rounded-xs bg-sunk" />
            <div className="mt-2 h-1 w-full rounded-full bg-sunk" />
          </div>
        ))}
      </div>
      <div className="h-40 w-full rounded-sm bg-sunk" />
    </div>
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
              className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
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
          {partners.slice(0, 100).map((p) => {
            const over = Number(p.amountsByBucket['over-90']);
            return (
              <tr
                key={p.accountId}
                className="border-t border-line transition-colors duration-fast hover:bg-sunk/50"
              >
                <td className="px-3 py-2 font-mono text-xs tabular-nums text-ink">
                  {p.accountCode}
                </td>
                <td className="px-3 py-2 text-ink">{p.accountLabel}</td>
                {AGING_BUCKETS.map((b) => {
                  const v = Number(p.amountsByBucket[b]);
                  return (
                    <td
                      key={b}
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
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
                <td className="px-3 py-2 text-right font-mono font-medium tabular-nums text-ink">
                  {formatAmount(Number(p.totalOutstanding))}
                  {over > 0 && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-critical-soft px-1.5 py-0 text-2xs font-medium text-critical-ink">
                      <ArrowUp className="mr-0.5 inline h-2 w-2" /> 90j+
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t border-line bg-sunk text-sm font-medium text-ink">
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
                <td key={b} className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatAmount(total)}
                </td>
              );
            })}
            <td className="px-3 py-2 text-right font-mono tabular-nums">
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
// SEGMENTED CONTROL
// ─────────────────────────────────────────────────────────────────────

interface SegmentedOption {
  readonly value: string;
  readonly label: string;
}

function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<SegmentedOption>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex gap-0.5 rounded-sm border border-line bg-sunk p-0.5"
    >
      {options.map((o) => {
        const isActive = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(o.value)}
            className={`press rounded-xs px-3 py-1.5 text-xs font-medium transition-colors duration-fast ${
              isActive
                ? 'bg-paper text-ink shadow-sm'
                : 'text-ink-soft hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────────────────────────────────

function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
        <Icon className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
      </span>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 max-w-[40ch] text-xs text-ink-mute">{description}</p>
      </div>
      {actionLabel !== undefined && actionHref !== undefined && (
        <a
          href={actionHref}
          className="press inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas"
        >
          {actionLabel}
        </a>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CASHFLOW (AreaChart)
// ─────────────────────────────────────────────────────────────────────

const CHART_ACCENT = '#3f8a52';
const CHART_CRITICAL = '#b3441f';
const CHART_INFO = '#3c5d99';
const CHART_GRID = '#e7e3dc';
const CHART_INK_SOFT = '#5c5c66';

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
    <section className={PANEL_PADDED}>
      <div className="border-b border-line pb-3">
        <h2 className="font-display text-xl font-medium text-ink">Flux de trésorerie</h2>
        <p className="mt-1 text-sm text-ink-mute">
          Encaissements / décaissements mensuels et solde de trésorerie cumulé
        </p>
      </div>
      <div className="pt-4">
        {cashflowQuery.isLoading ? (
          <ChartSkeleton />
        ) : cashflowQuery.error ? (
          <FormError error={cashflowQuery.error} />
        ) : points.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title="Aucun flux de trésorerie"
            description="Aucun mouvement sur les comptes de trésorerie pour cet exercice."
          />
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

function ChartSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-sm bg-sunk px-3 py-2">
            <div className="h-3 w-20 rounded-xs bg-paper" />
            <div className="mt-1 h-4 w-24 rounded-xs bg-paper" />
          </div>
        ))}
      </div>
      <div className="h-64 w-full rounded-sm bg-sunk" />
    </div>
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
    <section className={PANEL_PADDED}>
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
          <ChartSkeleton />
        ) : evolutionQuery.error ? (
          <FormError error={evolutionQuery.error} />
        ) : points.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="Aucun produit / charge"
            description="Validez des écritures sur les classes 6 et 7 pour voir l'évolution."
          />
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

const PIE_COLORS = [
  '#3f8a52',
  '#3c5d99',
  '#c08329',
  '#b3441f',
  '#5c5c66',
  '#6b9c7c',
  '#7a8baf',
  '#a78c5e',
  '#b87a5e',
  '#8a8a96',
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
    <section className={PANEL_PADDED}>
      <div className="border-b border-line pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-medium text-ink">Top comptes</h2>
            <p className="mt-1 text-sm text-ink-mute">
              {category === 'expenses' ? 'Top 10 charges' : 'Top 10 produits'} de l'exercice
            </p>
          </div>
          <SegmentedControl
            options={[
              { value: 'expenses', label: 'Charges' },
              { value: 'revenue', label: 'Produits' },
            ]}
            value={category}
            onChange={(v) => setCategory(v as TopAccountCategory)}
          />
        </div>
      </div>
      <div className="pt-4">
        {topQuery.isLoading ? (
          <ChartSkeleton />
        ) : topQuery.error ? (
          <FormError error={topQuery.error} />
        ) : pieData.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="Aucune écriture sur cette catégorie"
            description="Validez des écritures pour voir les top comptes."
          />
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
                      className="border-t border-line transition-colors duration-fast hover:bg-sunk/50"
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                          />
                          <span className="font-mono text-xs tabular-nums text-ink">{r.accountCode}</span>
                          <span className="truncate text-ink">{r.accountLabel}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{formatAmount(Number(r.amount))}</td>
                      <td className="px-3 py-2 text-right text-xs text-ink-mute tabular-nums">{r.sharePercent}%</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-line bg-sunk text-sm font-medium text-ink">
                  <tr>
                    <td className="px-3 py-2">Total catégorie</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatAmount(Number(top?.totalAmount ?? 0))}</td>
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
    <div className="rounded-sm border border-line bg-sunk px-3 py-2">
      <div className="text-xs text-ink-mute">{label}</div>
      <div className={`font-mono text-sm font-semibold tabular-nums ${color}`}>
        {formatAmount(value)} {currency !== undefined && <span className="text-xs">{currency}</span>}
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
