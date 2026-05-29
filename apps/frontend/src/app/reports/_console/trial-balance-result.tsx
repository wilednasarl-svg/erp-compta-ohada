'use client';

/**
 * Rendu de la Balance générale — consomme `TrialBalanceReport`. Composant
 * autonome (sans dépendance au monolithe). Colonnes : ouverture, mouvements,
 * clôture (débit/crédit), conforme à la présentation comptable usuelle.
 */

import { CheckCircle2, TriangleAlert } from 'lucide-react';

import type { TrialBalanceReport } from '@/types/reports';

import { cn } from '@/lib/utils';

import { formatHuman } from './presets';

const fmt = (raw: string): string => {
  const n = Number(raw);
  if (Number.isNaN(n) || n === 0) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
};

export function TrialBalanceResult({ report }: { readonly report: TrialBalanceReport }) {
  const diff = Math.abs(Number(report.totals.endingDebit) - Number(report.totals.endingCredit));
  const balanced = diff < 1;

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm',
          balanced
            ? 'border-accent/25 bg-accent-soft/50 text-accent-ink'
            : 'border-critical/30 bg-critical-soft text-critical-ink',
        )}
        role="status"
      >
        {balanced ? (
          <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        ) : (
          <TriangleAlert className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        )}
        {balanced
          ? `Balance équilibrée · ${report.rows.length} comptes · ${formatHuman(report.fromDate)} → ${formatHuman(report.toDate)}`
          : `Balance déséquilibrée · écart clôture de ${new Intl.NumberFormat('fr-FR').format(Math.round(diff))} FCFA`}
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-paper">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-strong bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
                <th className="px-4 py-1.5 text-left font-medium">Compte</th>
                <th className="px-3 py-1.5 text-right font-medium">Ouv. D</th>
                <th className="px-3 py-1.5 text-right font-medium">Ouv. C</th>
                <th className="px-3 py-1.5 text-right font-medium">Mvt D</th>
                <th className="px-3 py-1.5 text-right font-medium">Mvt C</th>
                <th className="px-3 py-1.5 text-right font-medium">Clôt. D</th>
                <th className="px-4 py-1.5 text-right font-medium">Clôt. C</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.accountId} className="border-b border-line/60 transition-colors hover:bg-sunk/50">
                  <td className="px-4 py-1.5 text-ink">
                    <span className="font-mono text-ink-mute">{row.accountCode}</span> {row.accountLabel}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-soft">{fmt(row.openingDebit)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-soft">{fmt(row.openingCredit)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink">{fmt(row.periodDebit)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink">{fmt(row.periodCredit)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums font-medium text-ink">{fmt(row.endingDebit)}</td>
                  <td className="px-4 py-1.5 text-right font-mono tabular-nums font-medium text-ink">{fmt(row.endingCredit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-sunk font-medium text-ink">
                <td className="px-4 py-2">Totaux</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(report.totals.openingDebit)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(report.totals.openingCredit)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(report.totals.periodDebit)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(report.totals.periodCredit)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(report.totals.endingDebit)}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">{fmt(report.totals.endingCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
