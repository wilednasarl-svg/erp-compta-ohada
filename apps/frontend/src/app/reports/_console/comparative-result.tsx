'use client';

/**
 * Rendu de la Balance comparative — consomme `ComparativeBalanceReport`.
 * Confronte les mouvements de la période N à ceux de N-1, avec variation.
 * Composant autonome.
 */

import type { ComparativeBalanceReport } from '@/types/reports';

import { cn } from '@/lib/utils';

import { formatHuman } from './presets';

const fmt = (raw: string): string => {
  const n = Number(raw);
  if (Number.isNaN(n) || n === 0) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
};

const net = (debit: string, credit: string): string => fmt(String(Number(debit) - Number(credit)));

const formatPct = (raw: string | null): string => {
  if (raw === null) return '';
  const n = Number(raw);
  if (Number.isNaN(n)) return '';
  return `${n > 0 ? '+' : ''}${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
};

export function ComparativeResult({ report }: { readonly report: ComparativeBalanceReport }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-sunk/40 px-4 py-2.5 text-sm text-ink-soft" role="status">
        {report.rows.length} comptes
        <span className="ml-auto text-2xs text-ink-mute">
          N : {formatHuman(report.fromDate)} → {formatHuman(report.toDate)} · N-1 :{' '}
          {formatHuman(report.previousFromDate)} → {formatHuman(report.previousToDate)}
        </span>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-paper">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-strong bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
                <th className="px-4 py-1.5 text-left font-medium">Compte</th>
                <th className="px-3 py-1.5 text-right font-medium">Mvt N-1</th>
                <th className="px-3 py-1.5 text-right font-medium">Mvt N</th>
                <th className="px-3 py-1.5 text-right font-medium">Variation</th>
                <th className="px-4 py-1.5 text-right font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.accountId} className="border-b border-line/60 transition-colors hover:bg-sunk/40">
                  <td className="px-4 py-1.5 text-ink">
                    <span className="font-mono text-ink-mute">{row.accountCode}</span> {row.accountLabel}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-soft">
                    {net(row.previousPeriodDebit, row.previousPeriodCredit)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink">
                    {net(row.periodDebit, row.periodCredit)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-soft">{fmt(row.netVariation)}</td>
                  <td
                    className={cn(
                      'px-4 py-1.5 text-right font-mono tabular-nums text-2xs',
                      Number(row.netVariationPercent) > 0 ? 'text-accent-ink' : Number(row.netVariationPercent) < 0 ? 'text-critical-ink' : 'text-ink-mute',
                    )}
                  >
                    {formatPct(row.netVariationPercent)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-sunk font-medium text-ink">
                <td className="px-4 py-2">Totaux mouvements</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{net(report.totals.previousPeriodDebit, report.totals.previousPeriodCredit)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{net(report.totals.periodDebit, report.totals.periodCredit)}</td>
                <td className="px-3 py-2" />
                <td className="px-4 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
