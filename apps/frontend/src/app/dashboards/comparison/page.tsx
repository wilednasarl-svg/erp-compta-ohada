'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Banknote,
  TrendingUp,
  Users,
  Coins,
  History,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import type { DashboardComparisonSummary } from '@/types/dashboards';

export default function ComparisonDashboardPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  const currentYear = new Date().getFullYear();
  const [selectedYears, setSelectedYears] = useState<number[]>([
    currentYear - 1,
    currentYear,
  ]);

  const availableYears = Array.from({ length: 10 }).map((_, i) => currentYear - i);

  const toggleYear = (y: number): void => {
    setSelectedYears((prev) => {
      if (prev.includes(y)) {
        if (prev.length <= 2) return prev; // Keep at least 2 years to compare
        return prev.filter((year) => year !== y);
      }
      if (prev.length >= 5) return prev; // Max 5 years
      return [...prev, y].sort((a, b) => a - b);
    });
  };

  const queryParams = new URLSearchParams();
  selectedYears.forEach((y) => queryParams.append('years', y.toString()));

  const comparisonQuery = useQuery<{ comparison: DashboardComparisonSummary }, ApiError>({
    queryKey: ['dashboard-comparison', orgId, selectedYears],
    queryFn: async () =>
      api.get(`/organizations/${orgId}/dashboards/comparison?${queryParams.toString()}`),
    enabled: orgId !== '' && selectedYears.length >= 2,
  });

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        <header>
          <p className="eyebrow">Pilotage · Multi-exercices</p>
          <h1 className="mt-2 font-display text-4xl font-medium tracking-tight text-ink">
            Comparaison annuelle
          </h1>
          <p className="mt-2 max-w-[64ch] text-sm text-ink-soft">
            Analysez les performances et la structure financière de l'entreprise sur plusieurs exercices (jusqu'à 5 ans).
          </p>
        </header>

        {/* ── Filters ──────────────────────────────────────────── */}
        <section className="rounded-sm border border-line bg-paper p-5">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Périodes</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Sélectionnez entre 2 et 5 années pour la comparaison.
            </p>
          </div>

          <div className="pt-4">
            <div className="flex flex-wrap gap-2">
              {availableYears.map((y) => {
                const checked = selectedYears.includes(y);
                const disabled = !checked && selectedYears.length >= 5;
                const disableUncheck = checked && selectedYears.length <= 2;
                return (
                  <button
                    key={y}
                    type="button"
                    onClick={() => toggleYear(y)}
                    disabled={disabled || disableUncheck}
                    className={`flex items-center justify-center rounded-sm border px-4 py-2 text-sm font-medium transition-colors duration-fast ${
                      checked
                        ? 'border-accent bg-accent-soft text-accent-ink'
                        : 'border-line bg-paper text-ink hover:bg-sunk'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {y}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-ink-mute">
              {selectedYears.length} année(s) sélectionnée(s) sur 5 maximum.
            </p>
          </div>
        </section>

        {/* ── Body ─────────────────────────────────────────────── */}
        {comparisonQuery.isLoading ? (
          <ComparisonSkeleton />
        ) : comparisonQuery.error ? (
          <div className="rounded-sm border border-critical/40 bg-critical-soft p-4">
            <FormError error={comparisonQuery.error} />
          </div>
        ) : (
          comparisonQuery.data?.comparison && (
            <ComparisonResults data={comparisonQuery.data.comparison} />
          )
        )}
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────────────────────────────

function ComparisonResults({ data }: { data: DashboardComparisonSummary }) {
  if (data.yearsData.length === 0) {
    return (
      <div className="rounded-sm border border-line bg-paper py-16 text-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
          <History className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
        </span>
        <div className="mt-4">
          <p className="text-sm font-medium text-ink">Aucune donnée disponible</p>
          <p className="mt-1 text-xs text-ink-mute">
            Il n'y a pas de données pour les exercices sélectionnés.
          </p>
        </div>
      </div>
    );
  }

  // To build a comparison table, we transpose the data
  // Columns: Years
  // Rows: Metrics
  const years = data.yearsData.map((d) => d.year);
  
  const metricsList = [
    { key: 'revenue', label: "Chiffre d'affaires", tone: 'positive' },
    { key: 'expenses', label: 'Charges', tone: 'negative' },
    { key: 'netResult', label: 'Résultat Net', tone: 'signed' },
    { key: 'cashBalance', label: 'Trésorerie', tone: 'positive' },
    { key: 'receivables', label: 'Créances', tone: 'neutral' },
    { key: 'payables', label: 'Dettes', tone: 'neutral' },
  ] as const;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="overflow-hidden rounded-sm border border-line bg-paper">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-sunk/50">
                <th className="p-4 font-medium text-ink-mute">Indicateur</th>
                {years.map((year, idx) => (
                  <th key={year} className="p-4 text-right font-medium text-ink">
                    <div className="flex flex-col items-end gap-1">
                      <span>{year}</span>
                      {idx > 0 && (
                        <span className="text-[10px] uppercase tracking-wider text-ink-mute">
                          vs {years[idx - 1]}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {metricsList.map((metric) => (
                <tr key={metric.key} className="transition-colors hover:bg-sunk/30">
                  <td className="p-4 font-medium text-ink">{metric.label}</td>
                  {data.yearsData.map((yearData, idx) => {
                    const currentVal = Number(yearData.metrics[metric.key]);
                    let growthNode = null;

                    if (idx > 0) {
                      const prevVal = Number(data.yearsData[idx - 1]?.metrics[metric.key] ?? 0);
                      if (prevVal !== 0) {
                        const growth = ((currentVal - prevVal) / Math.abs(prevVal)) * 100;
                        const isPositive = growth >= 0;
                        
                        let growthTone = 'text-ink-mute';
                        if (metric.tone === 'positive' || metric.tone === 'signed') {
                          growthTone = isPositive ? 'text-accent-ink' : 'text-critical-ink';
                        } else if (metric.tone === 'negative') {
                          growthTone = isPositive ? 'text-critical-ink' : 'text-accent-ink';
                        }
                        
                        growthNode = (
                          <span className={`text-xs font-medium ${growthTone}`}>
                            {isPositive ? '+' : ''}{growth.toFixed(1)}%
                          </span>
                        );
                      } else if (currentVal !== 0) {
                         growthNode = (
                          <span className="text-xs font-medium text-accent-ink">
                            +100%
                          </span>
                        );
                      } else {
                         growthNode = <span className="text-xs text-ink-mute">—</span>;
                      }
                    }

                    return (
                      <td key={yearData.year} className="p-4 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-mono tabular-nums text-ink">
                            {formatAmount(currentVal)}
                          </span>
                          {idx > 0 && growthNode}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-right text-xs text-ink-mute">
        Montants exprimés en {data.currency}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SKELETON
// ─────────────────────────────────────────────────────────────────────

function ComparisonSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-sm border border-line bg-paper">
      <div className="border-b border-line bg-sunk/50 p-4">
        <div className="h-5 w-32 rounded-xs bg-sunk" />
      </div>
      <div className="divide-y divide-line p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex justify-between py-4">
            <div className="h-4 w-24 rounded-xs bg-sunk" />
            <div className="h-4 w-16 rounded-xs bg-sunk" />
            <div className="h-4 w-16 rounded-xs bg-sunk" />
          </div>
        ))}
      </div>
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
