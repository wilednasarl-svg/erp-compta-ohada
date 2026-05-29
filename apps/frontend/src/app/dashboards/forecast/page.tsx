'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  TrendingDown,
  TrendingUp,
  Plus,
  Calendar,
  Wallet,
  AlertCircle,
  Loader2,
  Trash2,
  CheckCircle2,
} from 'lucide-react';
import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from 'recharts';
import { toast } from 'sonner';

import { AppShell } from '@/components/app-shell';
import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

interface CashFlowProjection {
  date: string;
  expectedBalance: string;
  inflows: string;
  outflows: string;
}

interface CashFlowForecastReport {
  currentCashBalance: string;
  projections: CashFlowProjection[];
}

interface CashFlowForecastItem {
  id: string;
  organizationId: string;
  title: string;
  description?: string;
  type: 'inflow' | 'outflow';
  amount: string;
  expectedDate: string;
  status: 'pending' | 'realized' | 'cancelled';
  category?: string;
  createdAt: string;
  updatedAt: string;
}

export default function ForecastDashboardPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const queryClient = useQueryClient();

  const [daysAhead, setDaysAhead] = useState<number>(30);
  const [showAddForm, setShowAddForm] = useState(false);

  // Queries
  const reportQuery = useQuery<CashFlowForecastReport, ApiError>({
    queryKey: ['cash-flow-projection', orgId, daysAhead],
    queryFn: async () =>
      api.get(`/organizations/${orgId}/cash-flow/projection?daysAhead=${daysAhead}`),
    enabled: orgId !== '',
  });

  const pendingForecastsQuery = useQuery<CashFlowForecastItem[], ApiError>({
    queryKey: ['cash-flow-forecasts', orgId, 'pending'],
    queryFn: async () =>
      api.get(`/organizations/${orgId}/cash-flow/forecasts?status=pending`),
    enabled: orgId !== '',
  });

  const report = reportQuery.data;
  const forecasts = pendingForecastsQuery.data ?? [];

  // Mutations
  const createForecast = useMutation<any, ApiError, any>({
    mutationFn: async (payload) =>
      api.post(`/organizations/${orgId}/cash-flow/forecasts`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash-flow-projection'] });
      queryClient.invalidateQueries({ queryKey: ['cash-flow-forecasts'] });
      setShowAddForm(false);
      toast.success('Prévision ajoutée avec succès.');
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteForecast = useMutation<any, ApiError, string>({
    mutationFn: async (id) =>
      api.delete(`/organizations/${orgId}/cash-flow/forecasts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash-flow-projection'] });
      queryClient.invalidateQueries({ queryKey: ['cash-flow-forecasts'] });
      toast.success('Prévision supprimée.');
    },
    onError: (err) => toast.error(err.message),
  });

  const updateStatus = useMutation<any, ApiError, { id: string; status: string }>({
    mutationFn: async ({ id, status }) =>
      api.patch(`/organizations/${orgId}/cash-flow/forecasts/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash-flow-projection'] });
      queryClient.invalidateQueries({ queryKey: ['cash-flow-forecasts'] });
      toast.success('Statut mis à jour.');
    },
    onError: (err) => toast.error(err.message),
  });

  // Chart Data preparation
  const chartData = (report?.projections ?? []).map((p) => ({
    date: p.date,
    dateLabel: new Date(p.date).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
    }),
    balance: Number(p.expectedBalance),
    inflows: Number(p.inflows),
    outflows: Number(p.outflows),
  }));

  const minBalance = chartData.reduce(
    (min, d) => Math.min(min, d.balance),
    report ? Number(report.currentCashBalance) : 0
  );

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        <header>
          <p className="eyebrow">Pilotage · Trésorerie</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink">
            Prévisions de Trésorerie
          </h1>
          <p className="mt-2 max-w-[64ch] text-sm text-ink-soft">
            Visualisez l'évolution future de votre trésorerie selon vos engagements à venir.
          </p>
        </header>

        {(reportQuery.isLoading || pendingForecastsQuery.isLoading) && !report ? (
          <ForecastSkeleton />
        ) : reportQuery.error ? (
          <div className="rounded-sm border border-critical/40 bg-critical-soft p-4">
            <FormError error={reportQuery.error} />
          </div>
        ) : report ? (
          <>
            {/* KPI Row */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <KpiCard
                label="Solde Actuel"
                value={report.currentCashBalance}
                icon={Wallet}
                tone="neutral"
              />
              <KpiCard
                label="Encaissements Prévus"
                value={forecasts
                  .filter((f) => f.type === 'inflow')
                  .reduce((acc, f) => acc + Number(f.amount), 0)
                  .toString()}
                icon={TrendingUp}
                tone="positive"
              />
              <KpiCard
                label="Décaissements Prévus"
                value={forecasts
                  .filter((f) => f.type === 'outflow')
                  .reduce((acc, f) => acc + Number(f.amount), 0)
                  .toString()}
                icon={TrendingDown}
                tone="negative"
              />
            </div>

            {/* Main Chart Area */}
            <section className="rounded-sm border border-line bg-paper p-5">
              <div className="mb-6 flex flex-col items-start justify-between gap-4 border-b border-line pb-4 md:flex-row md:items-center">
                <div>
                  <h2 className="font-display text-xl font-medium text-ink">
                    Projection (Cash Flow Forecast)
                  </h2>
                  <p className="mt-1 text-sm text-ink-mute">
                    Solde simulé jour par jour
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-ink-mute">Horizon :</span>
                  <select
                    value={daysAhead}
                    onChange={(e) => setDaysAhead(Number(e.target.value))}
                    className="h-8 rounded-sm border border-line bg-paper px-2 text-sm text-ink outline-none focus:border-accent"
                  >
                    <option value={15}>15 jours</option>
                    <option value={30}>1 mois</option>
                    <option value={90}>3 mois</option>
                    <option value={180}>6 mois</option>
                  </select>
                </div>
              </div>

              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorBalanceDanger" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-critical)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-critical)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line)" />
                    <XAxis
                      dataKey="dateLabel"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'var(--color-ink-mute)' }}
                      dy={10}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'var(--color-ink-mute)' }}
                      tickFormatter={(val) => formatShort(val)}
                      dx={-10}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine y={0} stroke="var(--color-critical)" strokeDasharray="3 3" />
                    <Area
                      type="stepAfter"
                      dataKey="balance"
                      stroke={minBalance < 0 ? 'var(--color-critical)' : 'var(--color-accent)'}
                      strokeWidth={2}
                      fillOpacity={1}
                      fill={minBalance < 0 ? 'url(#colorBalanceDanger)' : 'url(#colorBalance)'}
                      animationDuration={500}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Forecasts List */}
            <section className="rounded-sm border border-line bg-paper">
              <div className="flex items-center justify-between border-b border-line p-5">
                <div>
                  <h2 className="font-display text-xl font-medium text-ink">
                    Échéances Prévisionnelles
                  </h2>
                  <p className="mt-1 text-sm text-ink-mute">
                    Factures à venir, charges fixes, salaires, etc.
                  </p>
                </div>
                <button
                  onClick={() => setShowAddForm(!showAddForm)}
                  className="press inline-flex items-center gap-2 rounded-sm bg-accent px-3 py-2 text-sm font-medium text-canvas transition-colors hover:bg-accent-hover"
                >
                  <Plus className="h-4 w-4" />
                  Ajouter une prévision
                </button>
              </div>

              {showAddForm && (
                <div className="border-b border-line bg-sunk p-5">
                  <AddForecastForm
                    onCancel={() => setShowAddForm(false)}
                    onSubmit={(data) => createForecast.mutate(data)}
                    isPending={createForecast.isPending}
                  />
                </div>
              )}

              {forecasts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
                    <Calendar className="h-5 w-5 text-ink-mute" />
                  </span>
                  <p className="mt-4 text-sm font-medium text-ink">
                    Aucune échéance prévue
                  </p>
                  <p className="mt-1 text-sm text-ink-mute">
                    Ajoutez vos prochaines entrées ou sorties de trésorerie pour alimenter le graphique.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-ink-mute">
                        <th className="px-5 py-3 font-medium">Date</th>
                        <th className="px-5 py-3 font-medium">Titre</th>
                        <th className="px-5 py-3 font-medium">Type</th>
                        <th className="px-5 py-3 text-right font-medium">Montant</th>
                        <th className="px-5 py-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {forecasts
                        .slice()
                        .sort(
                          (a, b) =>
                            new Date(a.expectedDate).getTime() -
                            new Date(b.expectedDate).getTime()
                        )
                        .map((f) => (
                          <tr key={f.id} className="group transition-colors hover:bg-sunk">
                            <td className="whitespace-nowrap px-5 py-3 text-ink-soft">
                              {new Date(f.expectedDate).toLocaleDateString('fr-FR')}
                            </td>
                            <td className="px-5 py-3 font-medium text-ink">
                              {f.title}
                            </td>
                            <td className="px-5 py-3">
                              {f.type === 'inflow' ? (
                                <span className="inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-ink">
                                  <TrendingUp className="h-3 w-3" /> Encaissement
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 rounded-sm bg-critical-soft px-2 py-0.5 text-xs font-medium text-critical-ink">
                                  <TrendingDown className="h-3 w-3" /> Décaissement
                                </span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-5 py-3 text-right font-mono font-medium text-ink">
                              {formatAmount(Number(f.amount))}
                            </td>
                            <td className="px-5 py-3 text-right">
                              <div className="flex items-center justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                <button
                                  type="button"
                                  title="Marquer comme réalisé"
                                  onClick={() => updateStatus.mutate({ id: f.id, status: 'realized' })}
                                  className="p-1 text-ink-mute transition-colors hover:text-accent-ink"
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  title="Supprimer"
                                  onClick={() => {
                                    if (confirm('Supprimer cette prévision ?')) {
                                      deleteForecast.mutate(f.id);
                                    }
                                  }}
                                  className="p-1 text-ink-mute transition-colors hover:text-critical-ink"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

function AddForecastForm({
  onCancel,
  onSubmit,
  isPending,
}: {
  onCancel: () => void;
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [type, setType] = useState<'inflow' | 'outflow'>('outflow');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !amount || !date) return;
    onSubmit({
      title,
      type,
      amount,
      expectedDate: date,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-5 md:items-end">
      <div className="space-y-1.5 md:col-span-1">
        <label className="text-xs font-medium text-ink-mute">Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as any)}
          className="h-9 w-full rounded-sm border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="outflow">Décaissement</option>
          <option value="inflow">Encaissement</option>
        </select>
      </div>

      <div className="space-y-1.5 md:col-span-2">
        <label className="text-xs font-medium text-ink-mute">Titre</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex: Loyer, Salaires, Client X..."
          className="h-9 w-full rounded-sm border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent"
          required
        />
      </div>

      <div className="space-y-1.5 md:col-span-1">
        <label className="text-xs font-medium text-ink-mute">Montant (XOF)</label>
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="h-9 w-full rounded-sm border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent"
          required
        />
      </div>

      <div className="space-y-1.5 md:col-span-1">
        <label className="text-xs font-medium text-ink-mute">Date prévue</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 w-full rounded-sm border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent"
          required
        />
      </div>

      <div className="flex items-center gap-3 pt-2 md:col-span-5 md:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-ink-soft hover:text-ink"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="press inline-flex h-9 items-center justify-center rounded-sm bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-ink-strong disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: any;
  tone: 'positive' | 'negative' | 'neutral';
}) {
  const num = Number(value);
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
    <div className="rounded-sm border border-line bg-paper p-5 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-mute">
            {label}
          </p>
          <p className={`mt-3 font-mono text-2xl font-semibold tabular-nums ${color}`}>
            {formatAmount(num)}
          </p>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-sm ${bg}`}>
          <Icon className="h-4 w-4" strokeWidth={1.5} />
        </span>
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const balance = data.balance;
    const isNegative = balance < 0;

    return (
      <div className="min-w-[180px] rounded-sm border border-line bg-paper p-3 shadow-sm">
        <p className="mb-2 text-sm font-medium text-ink">{data.dateLabel}</p>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-ink-mute">Solde estimé</span>
            <span
              className={`font-mono font-medium ${
                isNegative ? 'text-critical-ink' : 'text-accent-ink'
              }`}
            >
              {formatAmount(balance)}
            </span>
          </div>
          {(data.inflows > 0 || data.outflows > 0) && (
            <div className="my-1 border-t border-line" />
          )}
          {data.inflows > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-ink-mute">Entrées</span>
              <span className="font-mono text-accent-ink">+{formatAmount(data.inflows)}</span>
            </div>
          )}
          {data.outflows > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-ink-mute">Sorties</span>
              <span className="font-mono text-critical-ink">-{formatAmount(data.outflows)}</span>
            </div>
          )}
        </div>
      </div>
    );
  }
  return null;
}

function ForecastSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-sm border border-line bg-paper" />
        ))}
      </div>
      <div className="h-[400px] rounded-sm border border-line bg-paper" />
      <div className="h-64 rounded-sm border border-line bg-paper" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
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
