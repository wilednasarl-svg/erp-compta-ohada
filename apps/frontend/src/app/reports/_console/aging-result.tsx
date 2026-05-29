'use client';

/**
 * Rendu de la Balance âgée — consomme `AgingBalanceReport`. Ventile les soldes
 * clients ou fournisseurs par tranche d'ancienneté (0-30j … >90j) à la date
 * d'arrêté. Composant autonome.
 */

import type { AgingBalanceReport } from '@/types/reports';

import { formatHuman } from './presets';

const fmt = (raw: string): string => {
  const n = Number(raw);
  if (Number.isNaN(n) || n === 0) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
};

export function AgingResult({ report }: { readonly report: AgingBalanceReport }) {
  const bucketLabels = report.rows[0]?.buckets.map((b) => b.label) ?? [];
  const sideLabel = report.side === 'CLIENT' ? 'Créances clients' : 'Dettes fournisseurs';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border border-line bg-sunk/40 px-4 py-2.5 text-sm text-ink-soft" role="status">
        {sideLabel} · {report.rows.length} comptes · total{' '}
        <span className="font-mono tabular-nums text-ink">{fmt(report.grandTotal)} FCFA</span>
        <span className="ml-auto text-2xs text-ink-mute">Arrêté au {formatHuman(report.asAtDate)}</span>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-paper">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-strong bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
                <th className="px-4 py-1.5 text-left font-medium">Compte</th>
                {bucketLabels.map((label) => (
                  <th key={label} className="px-3 py-1.5 text-right font-medium">{label}</th>
                ))}
                <th className="px-4 py-1.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.accountId} className="border-b border-line/60 transition-colors hover:bg-sunk/40">
                  <td className="px-4 py-1.5 text-ink">
                    <span className="font-mono text-ink-mute">{row.accountCode}</span> {row.accountLabel}
                  </td>
                  {row.buckets.map((bucket) => (
                    <td key={bucket.label} className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-soft">
                      {fmt(bucket.amount)}
                    </td>
                  ))}
                  <td className="px-4 py-1.5 text-right font-mono tabular-nums font-medium text-ink">{fmt(row.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-sunk font-medium text-ink">
                <td className="px-4 py-2">Totaux</td>
                {report.bucketTotals.map((total, i) => (
                  <td key={bucketLabels[i] ?? i} className="px-3 py-2 text-right font-mono tabular-nums">{fmt(total)}</td>
                ))}
                <td className="px-4 py-2 text-right font-mono tabular-nums">{fmt(report.grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
