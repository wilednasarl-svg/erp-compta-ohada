'use client';

/**
 * Rendu de la Balance pluriannuelle — consomme `MultiYearBalanceReport`. Une
 * colonne par exercice, le solde net de chaque compte par période. Composant
 * autonome.
 */

import type { MultiYearBalanceReport } from '@/types/reports';

import { fromIso } from './presets';

const fmt = (raw: string): string => {
  const n = Number(raw);
  if (Number.isNaN(n) || n === 0) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
};

export function MultiYearResult({ report }: { readonly report: MultiYearBalanceReport }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-paper">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-strong bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
              <th className="px-4 py-1.5 text-left font-medium">Compte</th>
              {report.periods.map((p) => (
                <th key={p.toDate} className="px-3 py-1.5 text-right font-medium">
                  {fromIso(p.toDate).getFullYear()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.accountId} className="border-b border-line/60 transition-colors hover:bg-sunk/40">
                <td className="px-4 py-1.5 text-ink">
                  <span className="font-mono text-ink-mute">{row.accountCode}</span> {row.accountLabel}
                </td>
                {row.netByPeriod.map((amount, i) => (
                  <td key={report.periods[i]?.toDate ?? i} className="px-3 py-1.5 text-right font-mono tabular-nums text-ink">
                    {fmt(amount)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
