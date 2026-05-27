'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Banknote,
  Building2,
  Coins,
  TrendingUp,
  Users,
} from 'lucide-react';
import Link from 'next/link';
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

  const toggleOrg = (id: string): void => {
    setSelectedOrgIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const selectAllOrgs = (): void => setSelectedOrgIds(organizations.map((org) => org.id));
  const deselectAllOrgs = (): void => setSelectedOrgIds([]);

  const queryParams = new URLSearchParams({ year: year.toString() });
  selectedOrgIds.forEach((id) => queryParams.append('organizationIds', id));

  const consolidatedQuery = useQuery<{ consolidated: DashboardConsolidatedSummary }, ApiError>({
    queryKey: ['dashboard-consolidated', orgId, year, selectedOrgIds],
    queryFn: async () =>
      api.get(`/organizations/${orgId}/dashboards/consolidated?${queryParams.toString()}`),
    enabled: orgId !== '' && selectedOrgIds.length > 0,
  });

  // No orgs at all → premium empty state
  if (organizations.length < 2) {
    return (
      <AppShell>
        <div className="mx-auto max-w-[1200px] animate-page-in space-y-8">
          <header>
            <p className="eyebrow">Pilotage · Multi-dossiers</p>
            <h1 className="mt-2 font-display text-4xl font-medium tracking-tight text-ink">
              Vue consolidée
            </h1>
            <p className="mt-2 max-w-[64ch] text-sm text-ink-soft">
              Agrégation multi-sociétés des KPIs : trésorerie, créances, dettes,
              rentabilité.
            </p>
          </header>

          <div className="rounded-sm border border-line bg-paper">
            <EmptyState
              icon={BarChart3}
              title="Aucune donnée consolidée"
              description="Ajoutez plusieurs organisations pour activer la vue consolidée et comparer les performances entre dossiers."
              actionLabel="Créer une organisation"
              actionHref="/organizations/new"
            />
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1200px] animate-page-in space-y-8">
        <header>
          <p className="eyebrow">Pilotage · Multi-dossiers</p>
          <h1 className="mt-2 font-display text-4xl font-medium tracking-tight text-ink">
            Vue consolidée
          </h1>
          <p className="mt-2 max-w-[64ch] text-sm text-ink-soft">
            Agrégation multi-sociétés des KPIs : trésorerie, créances, dettes,
            rentabilité.
          </p>
        </header>

        {/* ── Filters ──────────────────────────────────────────── */}
        <section className="rounded-sm border border-line bg-paper p-5">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Périmètre</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Choisissez l'année fiscale et les sociétés à consolider.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 pt-4 md:grid-cols-[220px_1fr]">
            <div className="space-y-2">
              <label
                htmlFor="year"
                className="text-xs font-medium uppercase tracking-wider text-ink-mute"
              >
                Année fiscale
              </label>
              <select
                id="year"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="flex h-9 w-full rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
              >
                {Array.from({ length: 10 }).map((_, i) => {
                  const y = new Date().getFullYear() - i;
                  return (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-ink-mute">
                  Sociétés · {selectedOrgIds.length}/{organizations.length}
                </span>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={selectAllOrgs}
                    className="font-medium text-ink transition-colors duration-fast hover:text-accent-ink"
                  >
                    Tout sélectionner
                  </button>
                  <span className="text-line-strong">·</span>
                  <button
                    type="button"
                    onClick={deselectAllOrgs}
                    className="font-medium text-ink-mute transition-colors duration-fast hover:text-ink"
                  >
                    Tout désélectionner
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {organizations.map((org) => {
                  const checked = selectedOrgIds.includes(org.id);
                  return (
                    <label
                      key={org.id}
                      className={`group flex cursor-pointer items-center gap-2.5 rounded-sm border px-3 py-2 text-sm transition-colors duration-fast ${
                        checked
                          ? 'border-accent bg-accent-soft'
                          : 'border-line bg-paper hover:bg-sunk'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOrg(org.id)}
                        className="h-3.5 w-3.5 rounded-xs border-line-strong text-accent focus:ring-1 focus:ring-accent"
                      />
                      <span
                        className={`truncate font-medium ${
                          checked ? 'text-accent-ink' : 'text-ink'
                        }`}
                      >
                        {org.name}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ── Body ─────────────────────────────────────────────── */}
        {selectedOrgIds.length === 0 ? (
          <div className="rounded-sm border border-line bg-paper">
            <EmptyState
              icon={Building2}
              title="Aucune société sélectionnée"
              description="Cochez au moins une société dans le filtre ci-dessus pour voir les données consolidées."
            />
          </div>
        ) : consolidatedQuery.isLoading ? (
          <ConsolidatedSkeleton />
        ) : consolidatedQuery.error ? (
          <div className="rounded-sm border border-critical/40 bg-critical-soft p-4">
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

// ─────────────────────────────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────────────────────────────

function ConsolidatedResults({ data }: { data: DashboardConsolidatedSummary }) {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="flex flex-col rounded-sm border border-line bg-paper p-5">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">
              Produits / Charges
            </h2>
            <p className="mt-1 text-sm text-ink-mute">
              Cumul consolidé sur l'année <span className="font-mono tabular-nums">{data.year}</span>
            </p>
          </div>
          <div className="flex-1 space-y-3 pt-4">
            <Row
              label="Produits (chiffre d'affaires)"
              value={data.metrics.revenue}
              currency={data.currency}
              tone="positive"
            />
            <Row
              label="Charges"
              value={data.metrics.expenses}
              currency={data.currency}
              tone="negative"
            />
            <div className="border-t border-line pt-3">
              <Row
                label="Résultat net"
                value={data.metrics.netResult}
                currency={data.currency}
                tone="signed"
                bold
              />
            </div>
          </div>
        </section>

        <section className="rounded-sm border border-line bg-paper p-5">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">
              Contribution par société
            </h2>
            <p className="mt-1 text-sm text-ink-mute">
              Classées par résultat net décroissant
            </p>
          </div>
          <div className="pt-4">
            {data.organizationsData.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="Aucune donnée"
                description="Aucune société du périmètre n'a de résultat pour cette année."
              />
            ) : (
              <OrgContributionList data={data} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function OrgContributionList({ data }: { data: DashboardConsolidatedSummary }) {
  const sorted = data.organizationsData
    .slice()
    .sort((a, b) => Number(b.metrics.netResult) - Number(a.metrics.netResult));

  const maxAbs = Math.max(
    ...sorted.map((o) => Math.abs(Number(o.metrics.netResult))),
    1,
  );

  return (
    <ul className="space-y-3">
      {sorted.map((org) => {
        const resultNum = Number(org.metrics.netResult);
        const isPositive = resultNum >= 0;
        const pct = (Math.abs(resultNum) / maxAbs) * 100;
        const initials = org.organizationName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w.charAt(0).toUpperCase())
          .join('');
        return (
          <li key={org.organizationId} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-sunk font-mono text-2xs font-medium tabular-nums text-ink-soft">
                  {initials || '—'}
                </span>
                <span
                  className="truncate text-sm font-medium text-ink"
                  title={org.organizationName}
                >
                  {org.organizationName}
                </span>
              </div>
              <span
                className={`shrink-0 font-mono text-sm font-medium tabular-nums ${
                  isPositive ? 'text-accent-ink' : 'text-critical-ink'
                }`}
              >
                {isPositive ? '+' : ''}
                {formatAmount(resultNum)}{' '}
                <span className="text-xs text-ink-mute">{data.currency}</span>
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-sunk">
              <div
                className={isPositive ? 'h-full bg-accent' : 'h-full bg-critical'}
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
// SKELETON
// ─────────────────────────────────────────────────────────────────────

function ConsolidatedSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-sm border border-line bg-paper p-5">
            <div className="flex items-center justify-between">
              <div className="h-3 w-28 rounded-xs bg-sunk" />
              <div className="h-9 w-9 rounded-full bg-sunk" />
            </div>
            <div className="mt-4 h-6 w-32 rounded-xs bg-sunk" />
            <div className="mt-2 h-3 w-10 rounded-xs bg-sunk" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-56 rounded-sm border border-line bg-paper" />
        <div className="h-56 rounded-sm border border-line bg-paper" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SHARED PARTS
// ─────────────────────────────────────────────────────────────────────

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

  const iconBg =
    tone === 'positive' || (tone === 'signed' && num >= 0)
      ? 'bg-accent-soft text-accent-ink'
      : tone === 'negative' || (tone === 'signed' && num < 0)
        ? 'bg-critical-soft text-critical-ink'
        : 'bg-sunk text-ink-soft';

  return (
    <div className="rounded-sm border border-line bg-paper p-5 transition-colors duration-fast hover:border-line-strong">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-mute">{label}</p>
          <p
            className={`mt-3 font-mono text-2xl font-semibold tabular-nums ${color}`}
          >
            {formatAmount(num)}
          </p>
          <p className="mt-0.5 text-xs text-ink-mute">{currency}</p>
        </div>
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-sm ${iconBg}`}
        >
          <Icon className="h-4 w-4" strokeWidth={1.5} />
        </span>
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
    <div className="flex items-baseline justify-between text-sm">
      <span className={bold ? 'font-medium text-ink' : 'text-ink-soft'}>{label}</span>
      <span className={`font-mono tabular-nums ${color} ${bold ? 'font-semibold' : ''}`}>
        {formatAmount(num)} <span className="text-xs text-ink-mute">{currency}</span>
      </span>
    </div>
  );
}

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
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
        <Icon className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
      </span>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 max-w-[40ch] text-xs text-ink-mute">{description}</p>
      </div>
      {actionLabel !== undefined && actionHref !== undefined && (
        <Link
          href={actionHref}
          className="press inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
