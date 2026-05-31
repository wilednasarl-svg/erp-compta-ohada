'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Banknote,
  TrendingDown,
  TrendingUp,
  Gauge,
  FileWarning,
  Users,
  UserCog,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

// ─────────────────────────────────────────────────────────────────────────────
// Types (miroir des DTO backend : budget-variance.response.ts)
// Les montants sont des chaînes DECIMAL(15,2).
// ─────────────────────────────────────────────────────────────────────────────

type BudgetScenario = 'BI' | 'BR' | 'REAL';
type BudgetType = 'OPEX' | 'CAPEX' | 'TRESO' | 'RH';
type BudgetGroupBy =
  | 'account'
  | 'cost_center'
  | 'project'
  | 'agency'
  | 'budget_type'
  | 'period';

interface BudgetVarianceRow {
  dimension: string | null;
  dimensionLabel: string | null;
  budget: string;
  actual: string;
  variance: string;
  variancePct: number | null;
  favorable: boolean;
  realizationPct: number | null;
}

interface BudgetVarianceReport {
  fiscalYear: number;
  budgetScenario: string;
  groupBy: string;
  rows: BudgetVarianceRow[];
  totalBudget: string;
  totalActual: string;
  totalVariance: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

const SCENARIO_OPTIONS: ReadonlyArray<{ value: BudgetScenario; label: string }> = [
  { value: 'BI', label: 'Budget initial (BI)' },
  { value: 'BR', label: 'Budget révisé (BR)' },
];

const BUDGET_TYPE_OPTIONS: ReadonlyArray<{ value: BudgetType; label: string }> = [
  { value: 'OPEX', label: 'OPEX' },
  { value: 'CAPEX', label: 'CAPEX' },
  { value: 'TRESO', label: 'Trésorerie' },
  { value: 'RH', label: 'RH' },
];

const MONTH_LABELS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

const CHART_TOP_N = 10;

// Vue DG/DAF = synthèse par axe ; vue chef de service = détail par compte.
type ManagementView = 'daf' | 'service';
const VIEW_GROUP_BY: Readonly<Record<ManagementView, BudgetGroupBy>> = {
  daf: 'cost_center',
  service: 'account',
};

function currentFiscalYear(): number {
  return new Date().getFullYear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetVsRealisePage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  const [fiscalYear, setFiscalYear] = useState<number>(currentFiscalYear());
  const [budgetScenario, setBudgetScenario] = useState<BudgetScenario>('BI');
  const [view, setView] = useState<ManagementView>('daf');
  const [budgetType, setBudgetType] = useState<BudgetType | ''>('');
  const [upToMonth, setUpToMonth] = useState<number | ''>('');

  const groupBy = VIEW_GROUP_BY[view];

  const params = useMemo(() => {
    const search = new URLSearchParams();
    search.set('fiscalYear', String(fiscalYear));
    search.set('budgetScenario', budgetScenario);
    search.set('groupBy', groupBy);
    if (budgetType) search.set('budgetType', budgetType);
    if (upToMonth) search.set('upToMonth', String(upToMonth));
    return search.toString();
  }, [fiscalYear, budgetScenario, groupBy, budgetType, upToMonth]);

  const reportQuery = useQuery<BudgetVarianceReport, ApiError>({
    queryKey: ['budget-variance', orgId, params],
    queryFn: async () =>
      api.get(`/organizations/${orgId}/budget/variance?${params}`),
    enabled: orgId !== '',
  });

  const report = reportQuery.data;
  const rows = report?.rows ?? [];

  const totalBudget = Number(report?.totalBudget ?? '0');
  const totalActual = Number(report?.totalActual ?? '0');
  const totalVariance = Number(report?.totalVariance ?? '0');
  const consumptionPct = totalBudget !== 0 ? (totalActual / totalBudget) * 100 : null;
  // Convention SYSCOHADA : variance = réalisé − budget. Le sens favorable dépend
  // du compte, donc on s'appuie sur le drapeau majoritaire des lignes pour la couleur globale.
  const globalFavorable = totalVariance <= 0;

  const chartData = useMemo(
    () =>
      rows
        .slice()
        .sort((a, b) => Number(b.budget) - Number(a.budget))
        .slice(0, CHART_TOP_N)
        .map((r) => ({
          label: rowLabel(r, groupBy),
          budget: Number(r.budget),
          actual: Number(r.actual),
        })),
    [rows, groupBy],
  );

  const yearOptions = useMemo(() => {
    const base = currentFiscalYear();
    return [base + 1, base, base - 1, base - 2, base - 3];
  }, []);

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        <header>
          <p className="eyebrow">Pilotage · Contrôle budgétaire</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink">
            Budget vs Réalisé
          </h1>
          <p className="mt-2 max-w-[64ch] text-sm text-ink-soft">
            Suivez la consommation du budget et analysez les écarts entre le budget
            voté et le réalisé comptable, par axe ou par compte.
          </p>
        </header>

        {/* Barre de filtres */}
        <section className="rounded-sm border border-line bg-paper p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Exercice">
              <select
                value={fiscalYear}
                onChange={(e) => setFiscalYear(Number(e.target.value))}
                className="h-9 w-full rounded-sm border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Scénario budgétaire">
              <select
                value={budgetScenario}
                onChange={(e) => setBudgetScenario(e.target.value as BudgetScenario)}
                className="h-9 w-full rounded-sm border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent"
              >
                {SCENARIO_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Type de budget">
              <select
                value={budgetType}
                onChange={(e) => setBudgetType(e.target.value as BudgetType | '')}
                className="h-9 w-full rounded-sm border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent"
              >
                <option value="">Tous types</option>
                {BUDGET_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Jusqu'au mois (cumul)">
              <select
                value={upToMonth}
                onChange={(e) =>
                  setUpToMonth(e.target.value ? Number(e.target.value) : '')
                }
                className="h-9 w-full rounded-sm border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent"
              >
                <option value="">Année entière</option>
                {MONTH_LABELS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Vue DG/DAF vs chef de service */}
          <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-mute">
              Niveau de lecture
            </p>
            <div className="inline-flex rounded-sm border border-line bg-sunk p-0.5">
              <ViewToggleButton
                active={view === 'daf'}
                onClick={() => setView('daf')}
                icon={UserCog}
                label="Vue DG / DAF (synthèse par axe)"
              />
              <ViewToggleButton
                active={view === 'service'}
                onClick={() => setView('service')}
                icon={Users}
                label="Vue chef de service (détail par compte)"
              />
            </div>
          </div>
        </section>

        {reportQuery.isLoading && !report ? (
          <BudgetSkeleton />
        ) : reportQuery.error ? (
          <div className="rounded-sm border border-critical/40 bg-critical-soft p-4">
            <FormError error={reportQuery.error} />
          </div>
        ) : report && rows.length === 0 ? (
          <EmptyState />
        ) : report ? (
          <>
            {/* KPI Row */}
            <div className="reveal-stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="Total budgété"
                value={totalBudget}
                icon={Banknote}
                tone="neutral"
              />
              <KpiCard
                label="Total réalisé"
                value={totalActual}
                icon={TrendingUp}
                tone="neutral"
              />
              <KpiCard
                label="Écart global"
                value={totalVariance}
                icon={globalFavorable ? TrendingDown : TrendingUp}
                tone={globalFavorable ? 'positive' : 'negative'}
                signed
              />
              <KpiCard
                label="Taux de consommation"
                value={consumptionPct}
                icon={Gauge}
                tone="neutral"
                percent
              />
            </div>

            {/* Graphique Budget vs Réalisé */}
            <section className="rounded-sm border border-line bg-paper p-5">
              <div className="mb-6 border-b border-line pb-4">
                <h2 className="font-display text-xl font-medium text-ink">
                  Budget vs Réalisé
                </h2>
                <p className="mt-1 text-sm text-ink-mute">
                  {chartData.length >= CHART_TOP_N
                    ? `Top ${CHART_TOP_N} dimensions par budget`
                    : 'Comparaison par dimension'}
                </p>
              </div>
              <div className="h-[340px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
                    barGap={4}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="var(--color-line)"
                    />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: 'var(--color-ink-mute)' }}
                      interval={0}
                      dy={8}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'var(--color-ink-mute)' }}
                      tickFormatter={(val) => formatShort(Number(val))}
                      dx={-8}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-sunk)' }} />
                    <Bar
                      dataKey="budget"
                      name="Budget"
                      fill="var(--color-ink-mute)"
                      radius={[2, 2, 0, 0]}
                      maxBarSize={28}
                    />
                    <Bar
                      dataKey="actual"
                      name="Réalisé"
                      fill="var(--color-accent)"
                      radius={[2, 2, 0, 0]}
                      maxBarSize={28}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 flex items-center gap-6 text-xs text-ink-mute">
                <LegendDot color="var(--color-ink-mute)" label="Budget" />
                <LegendDot color="var(--color-accent)" label="Réalisé" />
              </div>
            </section>

            {/* Tableau des écarts */}
            <section className="rounded-sm border border-line bg-paper">
              <div className="border-b border-line p-5">
                <h2 className="font-display text-xl font-medium text-ink">
                  Détail des écarts
                </h2>
                <p className="mt-1 text-sm text-ink-mute">
                  {view === 'daf'
                    ? 'Synthèse par axe analytique'
                    : 'Détail ligne à ligne par compte'}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-sunk text-xs uppercase tracking-wider text-ink-mute">
                      <th className="px-5 py-2 font-medium">Dimension</th>
                      <th className="px-5 py-2 text-right font-medium">Budget</th>
                      <th className="px-5 py-2 text-right font-medium">Réalisé</th>
                      <th className="px-5 py-2 text-right font-medium">Écart</th>
                      <th className="px-5 py-2 text-right font-medium">Écart %</th>
                      <th className="px-5 py-2 text-right font-medium">Taux conso.</th>
                      <th className="px-5 py-2 text-right font-medium">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r, idx) => {
                      const variance = Number(r.variance);
                      return (
                        <tr
                          key={`${r.dimension ?? 'na'}-${idx}`}
                          className="h-8 transition-colors hover:bg-sunk"
                        >
                          <td className="px-5 py-1.5 font-medium text-ink">
                            {rowLabel(r, groupBy)}
                          </td>
                          <td className="px-5 py-1.5 text-right font-mono tabular-nums text-ink-soft">
                            {formatAmount(Number(r.budget))}
                          </td>
                          <td className="px-5 py-1.5 text-right font-mono tabular-nums text-ink-soft">
                            {formatAmount(Number(r.actual))}
                          </td>
                          <td
                            className={`px-5 py-1.5 text-right font-mono tabular-nums font-medium ${
                              r.favorable ? 'text-accent-ink' : 'text-critical-ink'
                            }`}
                          >
                            {formatSigned(variance)}
                          </td>
                          <td className="px-5 py-1.5 text-right font-mono tabular-nums text-ink-soft">
                            {formatPct(r.variancePct)}
                          </td>
                          <td className="px-5 py-1.5 text-right font-mono tabular-nums text-ink-soft">
                            {formatPct(r.realizationPct)}
                          </td>
                          <td className="px-5 py-1.5 text-right">
                            <StatusBadge favorable={r.favorable} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Composants
// ─────────────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-ink-mute">{label}</label>
      {children}
    </div>
  );
}

function ViewToggleButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Users;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-paper text-ink shadow-none'
          : 'text-ink-mute hover:text-ink-soft'
      }`}
      aria-pressed={active}
    >
      <Icon className="h-4 w-4" strokeWidth={1.5} />
      {label}
    </button>
  );
}

interface KpiCardProps {
  label: string;
  value: number | null;
  icon: typeof Banknote;
  tone: 'positive' | 'negative' | 'neutral';
  signed?: boolean;
  percent?: boolean;
}

function KpiCard({ label, value, icon: Icon, tone, signed, percent }: KpiCardProps) {
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

  const display =
    value === null
      ? '—'
      : percent
        ? formatPct(value)
        : signed
          ? formatSigned(value)
          : formatAmount(value);

  return (
    <div className="rounded-sm border border-line bg-paper p-5 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-mute">
            {label}
          </p>
          <p className={`mt-3 font-mono text-2xl font-semibold tabular-nums ${color}`}>
            {display}
          </p>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-sm ${bg}`}>
          <Icon className="h-4 w-4" strokeWidth={1.5} />
        </span>
      </div>
    </div>
  );
}

function StatusBadge({ favorable }: { favorable: boolean }) {
  return favorable ? (
    <span className="inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-ink">
      <TrendingDown className="h-3 w-3" strokeWidth={1.5} /> Favorable
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-sm bg-critical-soft px-2 py-0.5 text-xs font-medium text-critical-ink">
      <TrendingUp className="h-3 w-3" strokeWidth={1.5} /> Défavorable
    </span>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: { budget: number; actual: number } }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const data = payload[0]?.payload;
  if (!data) return null;
  return (
    <div className="min-w-[200px] rounded-sm border border-line bg-paper p-3">
      <p className="mb-2 text-sm font-medium text-ink">{label}</p>
      <div className="space-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-ink-mute">Budget</span>
          <span className="font-mono tabular-nums text-ink-soft">
            {formatAmount(data.budget)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-mute">Réalisé</span>
          <span className="font-mono tabular-nums text-accent-ink">
            {formatAmount(data.actual)}
          </span>
        </div>
        <div className="my-1 border-t border-line" />
        <div className="flex items-center justify-between">
          <span className="text-ink-mute">Écart</span>
          <span
            className={`font-mono tabular-nums ${
              data.actual - data.budget <= 0 ? 'text-accent-ink' : 'text-critical-ink'
            }`}
          >
            {formatSigned(data.actual - data.budget)}
          </span>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-sm border border-line bg-paper py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
        <FileWarning className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
      </span>
      <p className="mt-4 text-sm font-medium text-ink">Aucune ligne budgétaire</p>
      <p className="mt-1 max-w-[42ch] text-sm text-ink-mute">
        Aucune donnée pour les filtres sélectionnés. Importez ou créez un budget pour
        cet exercice.
      </p>
    </div>
  );
}

function BudgetSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-sm border border-line bg-paper" />
        ))}
      </div>
      <div className="h-[420px] rounded-sm border border-line bg-paper" />
      <div className="h-72 rounded-sm border border-line bg-paper" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function rowLabel(r: BudgetVarianceRow, groupBy: BudgetGroupBy): string {
  if (groupBy === 'period') {
    const month = Number(r.dimension);
    if (Number.isInteger(month) && month >= 1 && month <= 12) {
      return MONTH_LABELS[month - 1] ?? String(month);
    }
  }
  return r.dimensionLabel ?? r.dimension ?? 'Non affecté';
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatSigned(amount: number): string {
  const sign = amount > 0 ? '+' : '';
  return sign + formatAmount(amount);
}

function formatPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value)} %`;
}

function formatShort(val: number): string {
  if (Math.abs(val) >= 1_000_000) {
    return (val / 1_000_000).toFixed(1) + 'M';
  }
  if (Math.abs(val) >= 1_000) {
    return (val / 1_000).toFixed(0) + 'k';
  }
  return val.toString();
}
