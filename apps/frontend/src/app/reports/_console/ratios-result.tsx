'use client';

/**
 * Rendu des Ratios financiers — consomme `FinancialRatiosReport`. Regroupe les
 * ratios par catégorie (structure, liquidité, solvabilité, rentabilité,
 * activité) et formate la valeur selon son unité (%, ratio, jours).
 * Composant autonome.
 */

import { Fragment } from 'react';

import type { FinancialRatio, FinancialRatiosReport, RatioCategory } from '@/types/reports';

const CATEGORY_LABEL: Record<RatioCategory, string> = {
  STRUCTURE: 'Structure',
  LIQUIDITE: 'Liquidité',
  SOLVABILITE: 'Solvabilité',
  RENTABILITE: 'Rentabilité',
  ACTIVITE: 'Activité',
};

const CATEGORY_ORDER: ReadonlyArray<RatioCategory> = [
  'STRUCTURE', 'LIQUIDITE', 'SOLVABILITE', 'RENTABILITE', 'ACTIVITE',
];

const formatValue = (ratio: FinancialRatio): string => {
  if (ratio.value === null) return 'n/d';
  const n = Number(ratio.value);
  if (Number.isNaN(n)) return 'n/d';
  const num = n.toLocaleString('fr-FR', { maximumFractionDigits: ratio.unit === 'DAYS' ? 0 : 2 });
  switch (ratio.unit) {
    case 'PERCENT': return `${num} %`;
    case 'DAYS': return `${num} j`;
    default: return num;
  }
};

export function RatiosResult({ report }: { readonly report: FinancialRatiosReport }) {
  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    ratios: report.ratios.filter((r) => r.category === cat),
  })).filter((g) => g.ratios.length > 0);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-paper">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line-strong bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
            <th className="px-4 py-1.5 text-left font-medium">Ratio</th>
            <th className="px-3 py-1.5 text-right font-medium">Valeur</th>
            <th className="px-4 py-1.5 text-left font-medium">Lecture</th>
          </tr>
        </thead>
        <tbody>
          {byCategory.map(({ cat, ratios }) => (
            <Fragment key={cat}>
              <tr className="border-b border-line bg-accent-soft/30">
                <td className="px-4 py-1.5 font-medium text-accent-ink" colSpan={3}>
                  {CATEGORY_LABEL[cat]}
                </td>
              </tr>
              {ratios.map((ratio) => (
                <tr key={ratio.code} className="border-b border-line/60 transition-colors hover:bg-sunk/40">
                  <td className="px-4 py-2">
                    <span className="text-ink">{ratio.label}</span>
                    <span className="mt-0.5 block font-mono text-2xs text-ink-mute">{ratio.formula}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-ink">
                    {formatValue(ratio)}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-soft">{ratio.interpretation ?? '—'}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
