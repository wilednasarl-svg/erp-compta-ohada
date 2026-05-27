'use client';

import { useQuery } from '@tanstack/react-query';
import { Banknote, Coins, Loader2, TrendingUp, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg, useOrganizations } from '@/stores/auth-store';
import type { DashboardConsolidatedSummary } from '@/types/dashboards';

export default function ConsolidatedDashboardPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const organizations = useOrganizations() ?? [];

  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>([]);

  // Automatically select all organizations on initial load
  useEffect(() => {
    if (organizations.length > 0 && selectedOrgIds.length === 0) {
      setSelectedOrgIds(organizations.map((org) => org.id));
    }
  }, [organizations, selectedOrgIds.length]);

  const toggleOrg = (id: string) => {
    setSelectedOrgIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const selectAllOrgs = () => setSelectedOrgIds(organizations.map((org) => org.id));
  const deselectAllOrgs = () => setSelectedOrgIds([]);

  const queryParams = new URLSearchParams({
    year: year.toString(),
  });
  selectedOrgIds.forEach((id) => queryParams.append('organizationIds', id));

  const consolidatedQuery = useQuery<{ consolidated: DashboardConsolidatedSummary }, ApiError>({
    queryKey: ['dashboard-consolidated', orgId, year, selectedOrgIds],
    queryFn: async () =>
      api.get(`/organizations/${orgId}/dashboards/consolidated?${queryParams.toString()}`),
    enabled: orgId !== '' && selectedOrgIds.length > 0,
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-[1200px] animate-page-in space-y-12">
        <header>
          <p className="eyebrow mb-3">Vue d'ensemble</p>
          <div className="flex items-baseline gap-4">
            <h1 className="font-display text-5xl font-medium tracking-tight text-ink sm:text-6xl">
              Consolidation
            </h1>
          </div>
          <div className="mt-4 h-px w-full bg-line" aria-hidden />
          <p className="mt-4 text-sm text-ink-soft">
            Agrégation multi-sociétés des KPIs (trésorerie, créances, dettes, rentabilité).
          </p>
        </header>

        <div className="rounded-xl border border-line bg-paper p-6 shadow-sm">
          <div className="mb-6">
            <h3 className="font-display text-lg font-medium text-ink">Filtres de consolidation</h3>
            <p className="text-sm text-ink-mute">Sélectionnez l'année fiscale et les sociétés à consolider.</p>
          </div>
          
          <div className="grid grid-cols-1 gap-8 md:grid-cols-[200px_1fr]">
            <div className="space-y-3">
              <label htmlFor="year" className="text-sm font-medium text-ink">Année fiscale</label>
              <select
                id="year"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {Array.from({ length: 10 }).map((_, i) => {
                  const y = new Date().getFullYear() - i;
                  return <option key={y} value={y}>{y}</option>;
                })}
              </select>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-ink">Sociétés à inclure ({selectedOrgIds.length}/{organizations.length})</label>
                <div className="space-x-4 text-xs font-medium">
                  <button onClick={selectAllOrgs} className="text-accent hover:text-accent-ink transition-colors">
                    Tout sélectionner
                  </button>
                  <button onClick={deselectAllOrgs} className="text-ink-mute hover:text-ink-soft transition-colors">
                    Tout désélectionner
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                {organizations.map((org) => (
                  <label
                    key={org.id}
                    className={`flex cursor-pointer items-center space-x-3 rounded-lg border p-3 text-sm transition-all duration-200 ${
                      selectedOrgIds.includes(org.id)
                        ? 'border-accent bg-accent/5 shadow-sm'
                        : 'border-line bg-sunk/30 hover:border-line-strong hover:bg-sunk/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedOrgIds.includes(org.id)}
                      onChange={() => toggleOrg(org.id)}
                      className="h-4 w-4 rounded border-line text-accent focus:ring-accent"
                    />
                    <span className="truncate font-medium text-ink">{org.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {selectedOrgIds.length === 0 ? (
          <div className="rounded-xl border border-line bg-paper py-16 text-center shadow-sm">
            <p className="text-ink-mute">Sélectionnez au moins une société pour voir les données consolidées.</p>
          </div>
        ) : consolidatedQuery.isLoading ? (
          <div className="rounded-xl border border-line bg-paper py-16 text-center shadow-sm">
            <Loader2 className="mx-auto mb-4 h-6 w-6 animate-spin text-ink-mute" />
            <p className="text-ink-mute">Calcul de la consolidation en cours…</p>
          </div>
        ) : consolidatedQuery.error ? (
          <div className="rounded-xl border border-critical bg-critical/5 p-6 shadow-sm">
            <FormError error={consolidatedQuery.error} />
          </div>
        ) : (
          consolidatedQuery.data?.consolidated && (
            <ConsolidatedResults data={consolidatedQuery.data.consolidated} />
          )
        )}
      </div>
    </AppShell>
  );
}

function ConsolidatedResults({ data }: { data: DashboardConsolidatedSummary }) {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Trésorerie globale"
          value={data.metrics.cashBalance}
          currency={data.currency}
          icon={Banknote}
          tone="positive"
        />
        <KpiCard
          label="Créances clients"
          value={data.metrics.receivables}
          currency={data.currency}
          icon={Users}
          tone="neutral"
        />
        <KpiCard
          label="Dettes fournisseurs"
          value={data.metrics.payables}
          currency={data.currency}
          icon={Coins}
          tone="neutral"
        />
        <KpiCard
          label="Résultat net"
          value={data.metrics.netResult}
          currency={data.currency}
          icon={TrendingUp}
          tone="signed"
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-paper p-6 shadow-sm flex flex-col">
          <div className="mb-6">
            <h3 className="font-display text-lg font-medium text-ink">Produits / Charges (Consolidé)</h3>
            <p className="text-sm text-ink-mute">Cumul sur l'année {data.year}</p>
          </div>
          <div className="flex-1 space-y-4">
            <Row label="Produits (Chiffre d'affaires)" value={data.metrics.revenue} currency={data.currency} tone="positive" />
            <Row label="Charges" value={data.metrics.expenses} currency={data.currency} tone="negative" />
            <div className="mt-4 border-t border-line pt-4">
              <Row
                label="Résultat net"
                value={data.metrics.netResult}
                currency={data.currency}
                tone="signed"
                bold
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-paper p-6 shadow-sm">
          <div className="mb-6">
            <h3 className="font-display text-lg font-medium text-ink">Détail par Société</h3>
            <p className="text-sm text-ink-mute">Contribution au résultat net</p>
          </div>
          
          {data.organizationsData.length === 0 ? (
            <p className="py-4 text-sm text-ink-mute">Aucune donnée trouvée.</p>
          ) : (
            <div className="space-y-4">
              {data.organizationsData
                .slice()
                .sort((a, b) => Number(b.metrics.netResult) - Number(a.metrics.netResult))
                .map((org) => {
                  const resultNum = Number(org.metrics.netResult);
                  const isPositive = resultNum >= 0;
                  return (
                    <div key={org.organizationId} className="flex items-center justify-between">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <span className="shrink-0 rounded bg-sunk px-2 py-1 font-mono text-xs font-medium text-ink-soft">
                          {org.organizationName.substring(0, 3).toUpperCase()}
                        </span>
                        <span className="truncate text-sm font-medium text-ink" title={org.organizationName}>
                          {org.organizationName}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`font-mono text-sm font-medium ${isPositive ? 'text-accent-ink' : 'text-critical-ink'}`}>
                          {isPositive ? '+' : ''}{formatAmount(resultNum)}
                        </span>
                        <span className="w-8 text-right text-xs text-ink-mute">{data.currency}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
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
          
  const bgIcon = 
    tone === 'positive' || (tone === 'signed' && num >= 0)
      ? 'bg-accent/10 text-accent-ink'
      : tone === 'negative' || (tone === 'signed' && num < 0)
        ? 'bg-critical/10 text-critical-ink'
        : 'bg-sunk/50 text-ink-soft';

  return (
    <div className="group rounded-xl border border-line bg-paper p-5 shadow-sm transition-all hover:border-line-strong hover:shadow-md">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-mute">{label}</p>
          <p className={`mt-2 font-display text-2xl font-semibold ${color}`}>
            {formatAmount(num)}
          </p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${bgIcon}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-1">
        <span className="text-xs text-ink-mute font-medium">{currency}</span>
      </div>
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
    <div className="flex items-center justify-between rounded-lg p-3 hover:bg-sunk/30 transition-colors">
      <span className={`text-sm ${bold ? 'font-medium text-ink' : 'text-ink-soft'}`}>{label}</span>
      <span className={`font-mono text-sm ${color} ${bold ? 'font-semibold' : ''}`}>
        {formatAmount(num)} <span className="text-xs text-ink-mute">{currency}</span>
      </span>
    </div>
  );
}
