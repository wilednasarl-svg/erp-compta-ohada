'use client';

/**
 * Rendu de la Marge par axe analytique — consomme `MarginByAxisReport`. Une
 * ligne par axe (chantier, projet…) avec la cascade CA → marge → VA → EBE →
 * résultat. Composant autonome.
 */

import type { MarginByAxisReport, MarginByAxisRow } from '@/types/reports';

import { formatHuman } from './presets';

const fmt = (raw: string): string => {
  const n = Number(raw);
  if (Number.isNaN(n) || n === 0) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
};

const pct = (raw: string | null): string => {
  if (raw === null) return '—';
  const n = Number(raw);
  if (Number.isNaN(n)) return '—';
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
};

function Row({ row, head }: { readonly row: MarginByAxisRow; readonly head?: boolean }) {
  return (
    <tr className={head ? 'bg-sunk font-medium text-ink' : 'border-b border-line/60 transition-colors hover:bg-sunk/40'}>
      <td className="px-4 py-1.5 text-ink">{head ? 'Total' : row.axisCode}</td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink">{fmt(row.chiffreAffaires)}</td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-soft">{fmt(row.achatsConsommes)}</td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink">{fmt(row.margeBrute)}</td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-2xs text-ink-mute">{pct(row.margeBrutePercent)}</td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-soft">{fmt(row.valeurAjoutee)}</td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-soft">{fmt(row.excedentBrutExploit)}</td>
      <td className="px-4 py-1.5 text-right font-mono tabular-nums font-medium text-ink">{fmt(row.resultatNet)}</td>
    </tr>
  );
}

export function MarginResult({ report }: { readonly report: MarginByAxisReport }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border border-line bg-sunk/40 px-4 py-2.5 text-sm text-ink-soft" role="status">
        Axe « {report.axisType} » · {report.rows.length} lignes
        <span className="ml-auto text-2xs text-ink-mute">
          {formatHuman(report.fromDate)} → {formatHuman(report.toDate)}
        </span>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-paper">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-strong bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
                <th className="px-4 py-1.5 text-left font-medium">Axe</th>
                <th className="px-3 py-1.5 text-right font-medium">CA</th>
                <th className="px-3 py-1.5 text-right font-medium">Achats</th>
                <th className="px-3 py-1.5 text-right font-medium">Marge brute</th>
                <th className="px-3 py-1.5 text-right font-medium">%</th>
                <th className="px-3 py-1.5 text-right font-medium">VA</th>
                <th className="px-3 py-1.5 text-right font-medium">EBE</th>
                <th className="px-4 py-1.5 text-right font-medium">Résultat</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <Row key={row.axisCode} row={row} />
              ))}
            </tbody>
            <tfoot>
              <Row row={report.totals} head />
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
