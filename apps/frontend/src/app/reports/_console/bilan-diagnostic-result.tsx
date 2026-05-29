'use client';

/**
 * Rendu du Bilan diagnostic — consomme `BilanDiagnosticReport`. Outil de
 * contrôle pré-clôture : équilibre du journal, ventilation par classe, comptes
 * non classés, écritures de fin d'exercice présentes/absentes. Composant autonome.
 */

import { CheckCircle2, TriangleAlert } from 'lucide-react';

import type { BilanDiagnosticReport } from '@/types/reports';

import { cn } from '@/lib/utils';

import { formatHuman } from './presets';

const fmt = (raw: string): string => {
  const n = Number(raw);
  if (Number.isNaN(n) || n === 0) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
};

function StatusBanner({ ok, okText, koText }: { readonly ok: boolean; readonly okText: string; readonly koText: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm',
        ok ? 'border-accent/25 bg-accent-soft/50 text-accent-ink' : 'border-critical/30 bg-critical-soft text-critical-ink',
      )}
      role="status"
    >
      {ok ? <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : <TriangleAlert className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
      {ok ? okText : koText}
    </div>
  );
}

const YEAR_END_LABELS: Record<string, string> = {
  amortissements: 'Amortissements',
  depreciations: 'Dépréciations',
  chargesConstateesAvance: 'Charges constatées d’avance',
  produitsConstatesAvance: 'Produits constatés d’avance',
  chargesAPayer: 'Charges à payer',
  produitsARecevoir: 'Produits à recevoir',
  provisionImpots: 'Provision impôts',
  variationStocks: 'Variation des stocks',
};

export function BilanDiagnosticResult({ report }: { readonly report: BilanDiagnosticReport }) {
  const yearEnd = report.yearEnd as unknown as Record<string, { present: boolean; totalAmount: string }>;

  return (
    <div className="space-y-4">
      <StatusBanner
        ok={report.journal.isBalanced}
        okText={`Journal équilibré · Σ débit = Σ crédit = ${fmt(report.journal.totalDebit)} FCFA`}
        koText={`Journal déséquilibré · écart de ${fmt(report.journal.imbalance)} FCFA`}
      />
      <StatusBanner
        ok={report.bilan.isEquilibrated}
        okText={`Bilan équilibré (après incorporation du résultat) · arrêté au ${formatHuman(report.asAtDate)}`}
        koText={`Bilan non équilibré · écart ajusté de ${fmt(report.bilan.adjDifference)} FCFA`}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-md border border-line bg-paper">
          <div className="border-b border-line bg-sunk px-4 py-2 text-2xs uppercase tracking-wider text-ink-mute">
            Ventilation par classe
          </div>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {report.byClass.map((c) => (
                <tr key={c.class} className="border-b border-line/60">
                  <td className="px-4 py-1.5 text-ink">
                    <span className="font-mono text-ink-mute">{c.class}</span> {c.label}
                    <span className="ml-1 text-2xs text-ink-mute">({c.accountCount})</span>
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono tabular-nums text-ink">{fmt(c.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-md border border-line bg-paper">
          <div className="border-b border-line bg-sunk px-4 py-2 text-2xs uppercase tracking-wider text-ink-mute">
            Écritures de fin d’exercice
          </div>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {Object.entries(YEAR_END_LABELS).map(([key, label]) => {
                const entry = yearEnd[key];
                if (!entry) return null;
                return (
                  <tr key={key} className="border-b border-line/60">
                    <td className="px-4 py-1.5 text-ink-soft">{label}</td>
                    <td className="px-4 py-1.5 text-right">
                      {entry.present ? (
                        <span className="font-mono tabular-nums text-ink">{fmt(entry.totalAmount)}</span>
                      ) : (
                        <span className="text-2xs text-warn-ink">absente</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {report.unclassified.length > 0 && (
        <div className="overflow-hidden rounded-md border border-warn/30 bg-warn-soft/40">
          <div className="border-b border-warn/20 px-4 py-2 text-2xs uppercase tracking-wider text-warn-ink">
            {report.unclassified.length} comptes non classés (à rattacher avant clôture)
          </div>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {report.unclassified.map((u) => (
                <tr key={u.code} className="border-b border-warn/10">
                  <td className="px-4 py-1.5 text-ink">
                    <span className="font-mono text-ink-mute">{u.code}</span> {u.label}
                  </td>
                  <td className="px-3 py-1.5 text-right text-2xs text-ink-mute">{u.side}</td>
                  <td className="px-4 py-1.5 text-right font-mono tabular-nums text-ink">{fmt(u.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
