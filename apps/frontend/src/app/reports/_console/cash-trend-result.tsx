'use client';

/**
 * Rendu de la Tendance de trésorerie — consomme `CashTrendReport`. Évolution
 * mensuelle de la trésorerie nette, avec mini-barres de niveau et variation
 * d'un mois à l'autre. Composant autonome.
 */

import type { CashTrendReport } from '@/types/reports';

import { cn } from '@/lib/utils';

const fmt = (raw: string): string => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(raw));

const formatChange = (raw: string | null): string => {
  if (raw === null) return '—';
  const n = Number(raw);
  if (Number.isNaN(n) || n === 0) return '—';
  return `${n > 0 ? '+' : ''}${fmt(String(n))}`;
};

export function CashTrendResult({ report }: { readonly report: CashTrendReport }) {
  const min = Number(report.minNetCash);
  const max = Number(report.maxNetCash);
  const span = max - min || 1;
  const level = (raw: string): number => Math.round(((Number(raw) - min) / span) * 100);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-line bg-sunk/40 px-4 py-2.5 text-sm" role="status">
        <span className="text-ink-soft">Trésorerie actuelle <span className="font-mono tabular-nums text-ink">{fmt(report.currentNetCash)} FCFA</span></span>
        <span className="text-ink-mute">min <span className="font-mono tabular-nums">{fmt(report.minNetCash)}</span></span>
        <span className="text-ink-mute">max <span className="font-mono tabular-nums">{fmt(report.maxNetCash)}</span></span>
        <span className="ml-auto text-2xs text-ink-mute">{report.fromMonth} → {report.toMonth}</span>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-paper">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-strong bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
              <th className="px-4 py-1.5 text-left font-medium">Mois</th>
              <th className="px-3 py-1.5 text-right font-medium">Trésorerie nette</th>
              <th className="px-3 py-1.5 text-right font-medium">Variation</th>
              <th className="w-1/3 px-4 py-1.5 text-left font-medium">Niveau</th>
            </tr>
          </thead>
          <tbody>
            {report.points.map((point) => {
              const negative = Number(point.netCash) < 0;
              return (
                <tr key={point.yearMonth} className="border-b border-line/60 transition-colors hover:bg-sunk/40">
                  <td className="px-4 py-1.5 font-mono tabular-nums text-ink">{point.yearMonth}</td>
                  <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', negative ? 'text-critical-ink' : 'text-ink')}>
                    {fmt(point.netCash)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-2xs text-ink-soft">
                    {formatChange(point.change)}
                  </td>
                  <td className="px-4 py-1.5">
                    <span className="block h-2 rounded-full bg-sunk">
                      <span
                        className={cn('block h-full rounded-full', negative ? 'bg-critical' : 'bg-accent')}
                        style={{ width: `${Math.max(2, level(point.netCash))}%` }}
                      />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
