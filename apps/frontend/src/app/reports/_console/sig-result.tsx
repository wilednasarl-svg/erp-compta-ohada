'use client';

/**
 * Rendu des Soldes Intermédiaires de Gestion (SIG) — consomme `SigReport`.
 * Affiche la cascade des soldes (XA…XI) avec leur formule de calcul et, si le
 * rapport la fournit, la colonne N-1 et la variation. Composant autonome.
 */

import type { SigReport } from '@/types/reports';

import { cn } from '@/lib/utils';

import { formatHuman } from './presets';

const fmt = (raw: string | undefined): string => {
  if (raw === undefined) return '—';
  const n = Number(raw);
  if (Number.isNaN(n) || n === 0) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
};

const formatPct = (raw: string | null | undefined): string => {
  if (raw === null || raw === undefined) return '';
  const n = Number(raw);
  if (Number.isNaN(n)) return '';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
};

export function SigResult({ report }: { readonly report: SigReport }) {
  const hasPrev = report.previous !== undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border border-line bg-sunk/40 px-4 py-2.5 text-sm text-ink-soft" role="status">
        Cascade des soldes intermédiaires de gestion
        <span className="ml-auto text-2xs text-ink-mute">
          {formatHuman(report.fromDate)} → {formatHuman(report.toDate)}
        </span>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-paper">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-strong bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
              <th className="px-4 py-1.5 text-left font-medium">Solde</th>
              <th className="px-3 py-1.5 text-right font-medium">Exercice N</th>
              {hasPrev && <th className="px-3 py-1.5 text-right font-medium">N-1</th>}
              {hasPrev && <th className="px-4 py-1.5 text-right font-medium">Var.</th>}
            </tr>
          </thead>
          <tbody>
            {report.soldes.map((solde) => (
              <tr key={solde.code} className="border-b border-line/60 transition-colors hover:bg-sunk/40">
                <td className="px-4 py-2">
                  <span className="font-mono text-ink-mute">{solde.code}</span>{' '}
                  <span className="font-medium text-ink">{solde.label}</span>
                  {solde.formula && (
                    <span className="mt-0.5 block text-2xs text-ink-mute">{solde.formula}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-ink">{fmt(solde.amount)}</td>
                {hasPrev && (
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-soft">{fmt(solde.previousAmount)}</td>
                )}
                {hasPrev && (
                  <td
                    className={cn(
                      'px-4 py-2 text-right font-mono tabular-nums text-2xs',
                      Number(solde.variationPercent) > 0 ? 'text-accent-ink' : Number(solde.variationPercent) < 0 ? 'text-critical-ink' : 'text-ink-mute',
                    )}
                  >
                    {formatPct(solde.variationPercent)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
