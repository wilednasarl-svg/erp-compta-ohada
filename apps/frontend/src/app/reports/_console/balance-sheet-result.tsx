'use client';

/**
 * Rendu du Bilan SYSCOHADA — consomme `BalanceSheetReport` tel que renvoyé par
 * l'API. Composant autonome (aucune dépendance au monolithe `reports/page.tsx`)
 * afin de rester sans conflit avec le travail parallèle. Hiérarchie officielle :
 * masse → rubrique → poste lettré ; colonne N-1 affichée si comparaison active.
 */

import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { Fragment } from 'react';

import type { BalanceSheetReport, BilanMasse } from '@/types/reports';

import { cn } from '@/lib/utils';

import { BilanRatios } from '../_components/bilan-ratios';
import { ReportHelp } from '../_components/report-help';
import { formatHuman } from './presets';

const fmt = (raw: string | undefined): string => {
  if (raw === undefined) return '—';
  const n = Number(raw);
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
};

interface BalanceSheetResultProps {
  readonly report: BalanceSheetReport;
}

export function BalanceSheetResult({ report }: BalanceSheetResultProps) {
  const compare = report.previous !== undefined;
  const difference = Math.abs(Number(report.totals.difference));
  const balanced = difference < 1;

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm',
          balanced
            ? 'border-accent/25 bg-accent-soft/50 text-accent-ink'
            : 'border-critical/30 bg-critical-soft text-critical-ink',
        )}
        role="status"
      >
        {balanced ? (
          <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        ) : (
          <TriangleAlert className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        )}
        {balanced
          ? `Bilan équilibré · Actif = Passif = ${fmt(report.totals.actif)} FCFA`
          : `Bilan déséquilibré · écart de ${fmt(report.totals.difference)} FCFA (Actif − Passif)`}
        {report.netResultIncorporated !== null && (
          <span className="ml-auto text-2xs text-ink-mute">
            Résultat net incorporé : {fmt(report.netResultIncorporated)} FCFA
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BilanSide
          title="Actif"
          asAtLabel={formatHuman(report.asAtDate)}
          masses={report.actifMasses}
          total={report.totals.actif}
          compare={compare}
        />
        <BilanSide
          title="Passif"
          asAtLabel={formatHuman(report.asAtDate)}
          masses={report.passifMasses}
          total={report.totals.passif}
          compare={compare}
        />
      </div>

      <BilanRatios report={report} />
      <ReportHelp topic="bilan" />
    </div>
  );
}

interface BilanSideProps {
  readonly title: string;
  readonly asAtLabel: string;
  readonly masses: ReadonlyArray<BilanMasse>;
  readonly total: string;
  readonly compare: boolean;
}

function BilanSide({ title, asAtLabel, masses, total, compare }: BilanSideProps) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-paper">
      <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
        <h3 className="font-display text-lg font-medium tracking-tight text-ink">{title}</h3>
        <p className="text-2xs text-ink-mute">Arrêté au {asAtLabel} · FCFA</p>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line-strong bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
            <th className="px-4 py-1.5 text-left font-medium">Poste</th>
            <th className="px-3 py-1.5 text-right font-medium">Net</th>
            {compare && <th className="px-4 py-1.5 text-right font-medium">Net N-1</th>}
          </tr>
        </thead>
        <tbody>
          {masses.map((masse) => (
            <Fragment key={masse.code}>
              <tr className="border-b border-line bg-accent-soft/30">
                <td className="px-4 py-1.5 font-medium text-accent-ink" colSpan={compare ? 3 : 2}>
                  <span className="font-mono text-accent-ink/70">{masse.code}</span> {masse.label}
                </td>
              </tr>
              {masse.rubriques.map((rubrique, ri) => (
                <Fragment key={`${masse.code}-${ri}`}>
                  {rubrique.postes.map((poste) => (
                    <tr key={poste.code} className="border-b border-line/60 transition-colors hover:bg-sunk/50">
                      <td className="px-4 py-1.5 text-ink">
                        <span className="font-mono text-ink-mute">{poste.code}</span> {poste.label}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink">{fmt(poste.net)}</td>
                      {compare && (
                        <td className="px-4 py-1.5 text-right font-mono tabular-nums text-ink-soft">{fmt(poste.netPrevious)}</td>
                      )}
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="border-b border-line-strong">
                <td className="px-4 py-1.5 text-right text-2xs uppercase tracking-wider text-ink-mute">
                  Total {masse.label.toLowerCase()}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums font-medium text-ink">{fmt(masse.total)}</td>
                {compare && (
                  <td className="px-4 py-1.5 text-right font-mono tabular-nums text-ink-soft">{fmt(masse.totalPrevious)}</td>
                )}
              </tr>
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-sunk">
            <td className="px-4 py-2 font-medium text-ink">Total {title.toLowerCase()}</td>
            <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-ink">{fmt(total)}</td>
            {compare && <td className="px-4 py-2" />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
