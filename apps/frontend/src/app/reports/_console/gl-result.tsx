'use client';

/**
 * Rendu du Grand livre d'un compte — consomme `GeneralLedgerReport`. Détail
 * chronologique des écritures avec solde progressif (D/C) après chaque ligne,
 * report à nouveau et totaux de clôture. Composant autonome.
 */

import type { GeneralLedgerReport, LedgerBalanceSide } from '@/types/reports';

import { formatHuman } from './presets';

const fmt = (raw: string): string => {
  const n = Number(raw);
  if (Number.isNaN(n) || n === 0) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
};

const balance = (abs: string, side: LedgerBalanceSide): string => {
  const n = Number(abs);
  if (Number.isNaN(n) || n === 0) return '—';
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n)} ${side}`;
};

export function GlResult({ report }: { readonly report: GeneralLedgerReport }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-line bg-sunk/40 px-4 py-2.5 text-sm" role="status">
        <span className="font-mono text-ink-mute">{report.accountCode}</span>
        <span className="font-medium text-ink">{report.accountLabel}</span>
        <span className="text-ink-soft">{report.lines.length} écritures</span>
        <span className="ml-auto text-2xs text-ink-mute">
          {formatHuman(report.fromDate)} → {formatHuman(report.toDate)}
        </span>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-paper">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-strong bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
                <th className="px-4 py-1.5 text-left font-medium">Date</th>
                <th className="px-2 py-1.5 text-left font-medium">Jnl</th>
                <th className="px-2 py-1.5 text-right font-medium">N°</th>
                <th className="px-3 py-1.5 text-left font-medium">Libellé</th>
                <th className="px-2 py-1.5 text-center font-medium">Let.</th>
                <th className="px-3 py-1.5 text-right font-medium">Débit</th>
                <th className="px-3 py-1.5 text-right font-medium">Crédit</th>
                <th className="px-4 py-1.5 text-right font-medium">Solde</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line bg-accent-soft/20">
                <td className="px-4 py-1.5 text-ink-soft" colSpan={7}>Report à nouveau</td>
                <td className="px-4 py-1.5 text-right font-mono tabular-nums text-ink">
                  {balance(report.opening.openingBalance, report.opening.openingBalanceSide)}
                </td>
              </tr>
              {report.lines.map((line) => (
                <tr key={line.lineId} className="border-b border-line/60 transition-colors hover:bg-sunk/40">
                  <td className="px-4 py-1.5 font-mono tabular-nums text-ink-soft">{formatHuman(line.entryDate)}</td>
                  <td className="px-2 py-1.5 font-mono text-ink-mute">{line.journalCode}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-ink-mute">{line.entryNumber}</td>
                  <td className="px-3 py-1.5 text-ink">{line.description ?? '—'}</td>
                  <td className="px-2 py-1.5 text-center font-mono text-2xs text-ink-mute">{line.letteringCode ?? ''}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink">{fmt(line.debit)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink">{fmt(line.credit)}</td>
                  <td className="px-4 py-1.5 text-right font-mono tabular-nums text-ink-soft">
                    {balance(line.runningBalanceAbs, line.runningBalanceSide)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-sunk font-medium text-ink">
                <td className="px-4 py-2" colSpan={5}>Totaux mouvements</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(report.totals.periodDebit)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(report.totals.periodCredit)}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {balance(report.totals.closingBalance, report.totals.closingBalanceSide)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
