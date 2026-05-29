'use client';

/**
 * Rendu du Tableau des Flux de Trésorerie (TFT) — consomme `CashFlowReport`
 * (SYSCOHADA Tome 3 p.34, codes Z). Affiche les 4 sections de flux (ZB-ZE)
 * avec leurs postes et sous-totaux, puis la cascade ZA → ZG → ZH, et le
 * contrôle de cohérence. Composant autonome.
 */

import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { Fragment } from 'react';

import type { CashFlowReport, CashFlowSection } from '@/types/reports';

import { cn } from '@/lib/utils';

import { formatHuman } from './presets';

const fmt = (raw: string): string => {
  const n = Number(raw);
  if (Number.isNaN(n) || n === 0) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
};

export function TftResult({ report }: { readonly report: CashFlowReport }) {
  const incoherence = Math.abs(Number(report.coherenceCheck));
  const coherent = incoherence < 1;
  const sections: ReadonlyArray<CashFlowSection> = [
    report.operatingFlows,
    report.investingFlows,
    report.financingFlowsEquity,
    report.financingFlowsDebt,
  ];

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm',
          coherent
            ? 'border-accent/25 bg-accent-soft/50 text-accent-ink'
            : 'border-critical/30 bg-critical-soft text-critical-ink',
        )}
        role="status"
      >
        {coherent ? (
          <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        ) : (
          <TriangleAlert className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        )}
        {coherent
          ? `Cohérent · trésorerie de clôture ${fmt(report.closingCash)} FCFA`
          : `Incohérence de ${new Intl.NumberFormat('fr-FR').format(Math.round(incoherence))} FCFA entre la cascade TFT et les comptes de classe 5 (défaut de mapping)`}
        <span className="ml-auto text-2xs text-ink-mute">
          {formatHuman(report.fromDate)} → {formatHuman(report.toDate)}
        </span>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-paper">
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr className="border-b border-line-strong bg-sunk font-medium text-ink">
              <td className="px-4 py-2">
                <span className="font-mono text-ink-mute">ZA</span> Trésorerie nette à l’ouverture
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums">{fmt(report.openingCash)}</td>
            </tr>

            {sections.map((section) => (
              <Fragment key={section.code}>
                <tr className="border-b border-line bg-accent-soft/30">
                  <td className="px-4 py-1.5 font-medium text-accent-ink" colSpan={2}>
                    <span className="font-mono text-accent-ink/70">{section.code}</span> {section.label}
                  </td>
                </tr>
                {section.postes.map((poste) => (
                  <tr key={poste.code} className="border-b border-line/60 transition-colors hover:bg-sunk/40">
                    <td className="px-4 py-1.5 text-ink-soft">
                      <span className="font-mono text-ink-mute">{poste.code}</span> {poste.label}
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono tabular-nums text-ink">{fmt(poste.amount)}</td>
                  </tr>
                ))}
                <tr className="border-b border-line-strong">
                  <td className="px-4 py-1.5 text-right text-2xs uppercase tracking-wider text-ink-mute">
                    Sous-total {section.code}
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono tabular-nums font-medium text-ink">{fmt(section.subtotal)}</td>
                </tr>
              </Fragment>
            ))}

            <tr className="border-b border-line">
              <td className="px-4 py-1.5 text-ink-soft">
                <span className="font-mono text-ink-mute">ZF</span> Total financement (ZD + ZE)
              </td>
              <td className="px-4 py-1.5 text-right font-mono tabular-nums text-ink">{fmt(report.financingFlowsTotal)}</td>
            </tr>
            <tr className="border-b border-line-strong font-medium text-ink">
              <td className="px-4 py-2">
                <span className="font-mono text-ink-mute">ZG</span> Variation totale de trésorerie
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums">{fmt(report.netCashVariation)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="bg-sunk font-medium text-ink">
              <td className="px-4 py-2">
                <span className="font-mono text-ink-mute">ZH</span> Trésorerie nette à la clôture
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums">{fmt(report.closingCash)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
