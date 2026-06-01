'use client';

/**
 * Rendu du Compte de Résultat OHADA — consomme `ProfitLossReport`. Affiche la
 * cascade doctrinale officielle (Tome 3 p. 33) : postes lettrés + Soldes
 * Intermédiaires de Gestion intercalés. Composant autonome (sans dépendance au
 * monolithe). Colonne N-1 affichée si le rapport la fournit.
 */

import { TrendingDown, TrendingUp } from 'lucide-react';

import type { ProfitLossReport } from '@/types/reports';

import { cn } from '@/lib/utils';

import { CompteResultatRatios } from '../_components/compte-resultat-ratios';
import { ReportHelp } from '../_components/report-help';
import { formatHuman } from './presets';

const fmt = (raw: string | undefined): string => {
  if (raw === undefined) return '—';
  const n = Number(raw);
  if (Number.isNaN(n) || n === 0) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
};

export function ProfitLossResult({ report }: { readonly report: ProfitLossReport }) {
  const resultat = Number(report.resultat);
  const profit = resultat >= 0;
  const hasPrev = report.previous !== undefined;

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm',
          profit
            ? 'border-accent/25 bg-accent-soft/50 text-accent-ink'
            : 'border-warn/30 bg-warn-soft text-warn-ink',
        )}
        role="status"
      >
        {profit ? (
          <TrendingUp className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        ) : (
          <TrendingDown className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        )}
        {profit ? 'Bénéfice net' : 'Perte nette'} de{' '}
        {new Intl.NumberFormat('fr-FR').format(Math.abs(Math.round(resultat)))} FCFA
        <span className="ml-auto text-2xs text-ink-mute">
          {formatHuman(report.fromDate)} → {formatHuman(report.toDate)}
        </span>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-paper">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-strong bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
              <th className="px-4 py-1.5 text-left font-medium">Réf.</th>
              <th className="px-3 py-1.5 text-left font-medium">Libellé</th>
              <th className="px-2 py-1.5 text-center font-medium">+/−</th>
              <th className="px-3 py-1.5 text-right font-medium">Exercice N</th>
              {hasPrev && <th className="px-4 py-1.5 text-right font-medium">N-1</th>}
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => {
              const isPivot = line.kind === 'SIG' || line.kind === 'RESULTAT';
              return (
                <tr
                  key={line.ref}
                  className={cn(
                    'border-b border-line/60 transition-colors',
                    isPivot ? 'bg-sunk/60 font-medium' : 'hover:bg-sunk/40',
                  )}
                >
                  <td className="px-4 py-1.5 font-mono text-ink-mute">{line.ref}</td>
                  <td className={cn('px-3 py-1.5', isPivot ? 'text-ink' : 'text-ink-soft')}>
                    {line.label}
                  </td>
                  <td className="px-2 py-1.5 text-center font-mono text-ink-mute">{line.sign ?? ''}</td>
                  <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', isPivot ? 'text-ink' : 'text-ink-soft')}>
                    {fmt(line.amountN)}
                  </td>
                  {hasPrev && (
                    <td className="px-4 py-1.5 text-right font-mono tabular-nums text-ink-mute">
                      {fmt(line.amountPrevious)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-sunk font-medium text-ink">
              <td className="px-4 py-2" colSpan={3}>
                Résultat net (produits {fmt(report.totalProduits)} − charges {fmt(report.totalCharges)})
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(report.resultat)}</td>
              {hasPrev && (
                <td className="px-4 py-2 text-right font-mono tabular-nums text-ink-mute">
                  {fmt(report.previous?.resultat)}
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>

      <CompteResultatRatios report={report} />
      <ReportHelp topic="compte-resultat" />
    </div>
  );
}
