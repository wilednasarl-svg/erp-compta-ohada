'use client';

/**
 * Prototype haute-fidélité du parcours « Report Console » — démontre la
 * refonte sur le Bilan (état à date, sémantique `as-at`) : guide en 3 temps,
 * champ de période unifié + presets, indice de validité, favoris, historique,
 * barre de progression, aperçu du résultat, export.
 *
 * 100 % piloté par mock (aucun appel backend) afin d'être consultable hors
 * ligne. Le commutateur « Scénario » en haut permet de visualiser les états
 * sain / déséquilibré / vide de l'indice de validité.
 */

import { Fragment, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { GENERATION_STAGES } from '../_console/generation-progress';
import {
  MOCK_BILAN_ACTIF,
  MOCK_BILAN_TOTAL,
  VALIDITY_SCENARIOS,
  type ValidityScenario,
} from '../_console/mock-data';
import { defaultPeriod, formatHuman, summarizePeriod } from '../_console/presets';
import { ReportRunner } from '../_console/report-runner';
import { useHistoryStore } from '../_console/stores';
import type { PeriodValue, RunStatus } from '../_console/types';

const DEMO_ORG = 'demo-org';
const MODE = 'balance-sheet';
const TOTAL_DURATION_MS = 2200;

const formatFcfa = (n: number): string => new Intl.NumberFormat('fr-FR').format(n);

export default function ReportConsolePrototype() {
  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod('as-at'));
  const [compare, setCompare] = useState(true);
  const [scenario, setScenario] = useState<ValidityScenario>('sain');
  const [status, setStatus] = useState<RunStatus>('idle');
  const [progress, setProgress] = useState({ value: 0, stage: GENERATION_STAGES[0] ?? '', etaMs: TOTAL_DURATION_MS });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const record = useHistoryStore((s) => s.record);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const runGeneration = (): void => {
    if (timer.current) clearInterval(timer.current);
    setStatus('running');
    const startedAt = Date.now();
    const tick = 80;
    timer.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const value = Math.min(1, elapsed / TOTAL_DURATION_MS);
      const stageIndex = Math.min(GENERATION_STAGES.length - 1, Math.floor(value * GENERATION_STAGES.length));
      setProgress({ value, stage: GENERATION_STAGES[stageIndex] ?? '', etaMs: TOTAL_DURATION_MS - elapsed });
      if (value >= 1) {
        if (timer.current) clearInterval(timer.current);
        const durationMs = Date.now() - startedAt;
        setStatus('ready');
        record(DEMO_ORG, MODE, period, durationMs, { compare });
      }
    }, tick);
  };

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 text-ink lg:px-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <DemoStrip scenario={scenario} onScenario={setScenario} />

        <header className="border-b border-line pb-5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">États · Reporting OHADA · Prototype</p>
          <h1 className="mt-1 font-display text-3xl font-medium tracking-tight text-ink">Bilan</h1>
          <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-ink-soft">
            Patrimoine et financement à une date donnée, conforme SYSCOHADA AUDCIF. Choisissez la
            date d’arrêté, activez la comparaison N-1 si besoin, puis générez. La validité de la
            période est vérifiée avant la génération.
          </p>
        </header>

        <ReportRunner
          orgId={DEMO_ORG}
          mode={MODE}
          periodLabel="Bilan"
          period={period}
          onPeriodChange={setPeriod}
          validity={VALIDITY_SCENARIOS[scenario]}
          status={status}
          progress={progress}
          onGenerate={runGeneration}
          onExport={() => undefined}
          scope={{ compare }}
          onApplyScope={(s) => setCompare(Boolean(s.compare))}
          scopeControls={
            <label className="flex h-9 cursor-pointer items-center gap-2 self-end whitespace-nowrap rounded-sm border border-line-strong bg-paper px-3 text-sm text-ink-soft transition-colors duration-fast hover:bg-sunk has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-ink">
              <input
                type="checkbox"
                checked={compare}
                onChange={(e) => setCompare(e.target.checked)}
                className="h-3.5 w-3.5 accent-accent"
              />
              Comparer à N-1
            </label>
          }
          emptyHint={
            <div className="space-y-1">
              <p className="text-sm font-medium text-ink">Aucun bilan généré pour le moment</p>
              <p className="text-sm text-ink-soft">
                Période sélectionnée : {summarizePeriod(period)}. Lancez la génération pour afficher
                l’actif et le passif.
              </p>
            </div>
          }
        >
          <BilanPreview compare={compare} period={period} />
        </ReportRunner>
      </div>
    </div>
  );
}

// ─── Commutateur de scénario (outil de démo uniquement) ──────────────────

function DemoStrip({ scenario, onScenario }: { readonly scenario: ValidityScenario; readonly onScenario: (s: ValidityScenario) => void }) {
  const options: ReadonlyArray<{ key: ValidityScenario; label: string }> = [
    { key: 'sain', label: 'Période saine' },
    { key: 'desequilibre', label: 'Journal déséquilibré' },
    { key: 'vide', label: 'Période vide' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-sm border border-dashed border-line-strong bg-paper px-3 py-2">
      <span className="text-2xs uppercase tracking-wider text-ink-mute">Démo · scénario de validité</span>
      <div className="flex gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onScenario(opt.key)}
            aria-pressed={scenario === opt.key}
            className={cn(
              'rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors duration-fast',
              scenario === opt.key
                ? 'border-accent bg-accent-soft text-accent-ink'
                : 'border-line-strong bg-paper text-ink-soft hover:border-ink hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Aperçu du Bilan (résultat) ───────────────────────────────────────────

function BilanPreview({ compare, period }: { readonly compare: boolean; readonly period: PeriodValue }) {
  const asAtLabel = period.kind === 'as-at' ? formatHuman(period.asAtDate) : '';
  return (
    <div className="overflow-hidden rounded-md border border-line bg-paper">
      <div className="flex items-baseline justify-between border-b border-line px-5 py-3">
        <h2 className="font-display text-xl font-medium tracking-tight text-ink">Actif</h2>
        <p className="text-xs text-ink-mute">Arrêté au {asAtLabel} · valeurs nettes en FCFA</p>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line-strong bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
            <th className="px-5 py-2 text-left font-medium">Poste</th>
            <th className="px-3 py-2 text-right font-medium">Brut</th>
            <th className="px-3 py-2 text-right font-medium">Net</th>
            {compare && <th className="px-5 py-2 text-right font-medium">Net N-1</th>}
          </tr>
        </thead>
        <tbody>
          {MOCK_BILAN_ACTIF.map((masse) => (
            <Fragment key={masse.title}>
              <tr className="border-b border-line bg-accent-soft/30">
                <td className="px-5 py-2 font-medium text-accent-ink" colSpan={compare ? 4 : 3}>
                  {masse.title}
                </td>
              </tr>
              {masse.rows.map((row) => (
                <tr key={row.poste} className="border-b border-line transition-colors hover:bg-sunk/60">
                  <td className="px-5 py-2 text-ink">
                    <span className="font-mono text-ink-mute">{row.poste}</span> {row.label}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-soft">{formatFcfa(row.brut)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{formatFcfa(row.net)}</td>
                  {compare && (
                    <td className="px-5 py-2 text-right font-mono tabular-nums text-ink-soft">{formatFcfa(row.netN1)}</td>
                  )}
                </tr>
              ))}
              <tr className="border-b border-line-strong">
                <td className="px-5 py-2 text-right text-xs uppercase tracking-wider text-ink-mute">Total {masse.title.toLowerCase()}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-ink">{formatFcfa(masse.total)}</td>
                {compare && (
                  <td className="px-5 py-2 text-right font-mono tabular-nums text-ink-soft">{formatFcfa(masse.totalN1)}</td>
                )}
              </tr>
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-sunk">
            <td className="px-5 py-2.5 font-medium text-ink">Total actif</td>
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5 text-right font-mono tabular-nums font-medium text-ink">{formatFcfa(MOCK_BILAN_TOTAL.net)}</td>
            {compare && (
              <td className="px-5 py-2.5 text-right font-mono tabular-nums text-ink-soft">{formatFcfa(MOCK_BILAN_TOTAL.netN1)}</td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
