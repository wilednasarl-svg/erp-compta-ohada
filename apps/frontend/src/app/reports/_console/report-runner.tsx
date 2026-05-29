'use client';

/**
 * ReportRunner — squelette de parcours partagé par tous les états.
 *
 * Une même barre, lue de deux façons :
 *  - le novice (dirigeant PME, junior, auditeur de passage) la parcourt comme
 *    un guide en 3 temps : ① Période → ② Périmètre → ③ Générer ;
 *  - l'expert ignore le guide et agit directement (presets clavier, favori
 *    rejoué, Entrée pour générer).
 *
 * Le composant ne sait rien du contenu de l'état : il reçoit la sélection de
 * période, un slot « périmètre », l'indice de validité, le statut de
 * génération et le résultat en `children`. Réutilisable tel quel sur d'autres
 * pages produit (TVA, inventaire, immobilisations).
 */

import { Download, FileSpreadsheet, FileText, History, Play, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import { DataValidityStrip } from './data-validity-strip';
import { DateRangeField } from './date-range-field';
import { GenerationProgress } from './generation-progress';
import { Popover } from './popover';
import { formatHuman, summarizePeriod } from './presets';
import { useFavorites, useFavoritesStore, useHistory } from './stores';
import type { PeriodValidity, PeriodValue, RunStatus } from './types';

interface ReportRunnerProps {
  readonly orgId: string;
  readonly mode: string;
  readonly periodLabel: string;
  readonly period: PeriodValue;
  readonly onPeriodChange: (next: PeriodValue) => void;

  readonly validity?: PeriodValidity;
  readonly validityLoading?: boolean;

  readonly status: RunStatus;
  readonly progress?: { readonly value: number; readonly stage: string; readonly etaMs?: number };
  readonly onGenerate: () => void;
  readonly onExport?: (format: 'pdf' | 'xlsx') => void;

  /** Slot « ② Périmètre » : comparaison N-1, filtre classe, axe analytique… */
  readonly scopeControls?: React.ReactNode;
  /** Périmètre courant sérialisé, mémorisé avec les favoris / l'historique. */
  readonly scope?: Record<string, string | boolean>;
  readonly onApplyScope?: (scope: Record<string, string | boolean>) => void;

  /** Contenu de l'état une fois généré. */
  readonly children: React.ReactNode;
  /** État vide pédagogique (statut idle). */
  readonly emptyHint?: React.ReactNode;
}

export function ReportRunner(props: ReportRunnerProps) {
  const {
    orgId, mode, periodLabel, period, onPeriodChange,
    validity, validityLoading, status, progress, onGenerate, onExport,
    scopeControls, scope, onApplyScope, children, emptyHint,
  } = props;

  const blocked = validity?.imbalance ? validity.imbalance > 0 : false;
  const hasScope = scopeControls !== undefined;

  return (
    <section className="space-y-4">
      <StepGuide hasScope={hasScope} status={status} />

      <div className="rounded-md border border-line bg-paper">
        {/* Toolbar */}
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-line p-4">
          <Field index={1} label="Période">
            <DateRangeField value={period} onChange={onPeriodChange} label={`${periodLabel} — choix de la période`} />
          </Field>

          {hasScope && (
            <Field index={2} label="Périmètre">
              <div className="flex flex-wrap items-end gap-2">{scopeControls}</div>
            </Field>
          )}

          <div className="ml-auto flex items-end gap-2">
            <FavoritesMenu
              orgId={orgId}
              mode={mode}
              period={period}
              scope={scope}
              onApply={(fav) => {
                onPeriodChange(fav.period);
                if (fav.scope && onApplyScope) onApplyScope({ ...fav.scope });
              }}
            />
            <HistoryMenu
              orgId={orgId}
              mode={mode}
              onApply={(run) => {
                onPeriodChange(run.period);
                if (run.scope && onApplyScope) onApplyScope({ ...run.scope });
              }}
            />
            <button
              type="button"
              onClick={onGenerate}
              disabled={status === 'running'}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-sm px-4 text-sm font-medium transition-colors duration-fast',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                'disabled:cursor-not-allowed disabled:opacity-60',
                'bg-accent text-paper hover:bg-accent/90',
              )}
            >
              <Play className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              Générer
            </button>
          </div>
        </div>

        {/* ③ Validité + progression + export */}
        <div className="space-y-3 p-4">
          <DataValidityStrip validity={validity} loading={validityLoading} />

          {status === 'running' && progress && (
            <GenerationProgress progress={progress.value} stage={progress.stage} etaMs={progress.etaMs} />
          )}

          {status === 'ready' && onExport && (
            <div className="flex items-center justify-between gap-3 rounded-sm border border-accent/25 bg-accent-soft/50 px-3 py-2">
              <span className="text-xs text-accent-ink">
                État prêt · {summarizePeriod(period)}
              </span>
              <div className="flex items-center gap-1.5">
                <ExportButton icon={FileText} label="PDF" onClick={() => onExport('pdf')} />
                <ExportButton icon={FileSpreadsheet} label="Excel" onClick={() => onExport('xlsx')} />
              </div>
            </div>
          )}

          {blocked && status !== 'running' && (
            <p className="text-xs text-critical-ink">
              Journal déséquilibré : l’état peut être généré pour contrôle, mais ne sera pas
              conforme tant que l’écart n’est pas corrigé.
            </p>
          )}
        </div>
      </div>

      {/* Résultat */}
      {status === 'idle' && (
        <div className="rounded-md border border-dashed border-line-strong bg-paper px-6 py-10 text-center">
          {emptyHint ?? (
            <p className="text-sm text-ink-soft">
              Choisissez une période, ajustez le périmètre si besoin, puis lancez la génération.
            </p>
          )}
        </div>
      )}
      {status === 'error' && (
        <div className="rounded-md border border-critical/30 bg-critical-soft px-4 py-3 text-sm text-critical-ink">
          La génération a échoué. Vérifiez la période puis réessayez.
        </div>
      )}
      {status === 'ready' && <div className="animate-fade-in">{children}</div>}
    </section>
  );
}

// ─── Guide d'étapes (pour les profils occasionnels) ──────────────────────

function StepGuide({ hasScope, status }: { readonly hasScope: boolean; readonly status: RunStatus }) {
  const steps = [
    { n: 1, label: 'Période', done: true },
    ...(hasScope ? [{ n: 2, label: 'Périmètre', done: true }] : []),
    { n: hasScope ? 3 : 2, label: 'Générer', done: status === 'ready' },
  ];
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-mute" aria-label="Étapes">
      {steps.map((step, i) => (
        <li key={step.label} className="inline-flex items-center gap-2">
          <span
            className={cn(
              'inline-flex h-5 w-5 items-center justify-center rounded-full font-mono text-2xs',
              step.done ? 'bg-accent-soft text-accent-ink' : 'border border-line-strong text-ink-mute',
            )}
          >
            {step.n}
          </span>
          <span className={step.done ? 'text-ink-soft' : undefined}>{step.label}</span>
          {i < steps.length - 1 && <span className="text-line-strong" aria-hidden>›</span>}
        </li>
      ))}
    </ol>
  );
}

function Field({ index, label, children }: { readonly index: number; readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-2xs uppercase tracking-wider text-ink-soft">
        <span className="font-mono text-ink-mute">{index}.</span>
        {label}
      </p>
      {children}
    </div>
  );
}

function ExportButton({ icon: Icon, label, onClick }: { readonly icon: typeof FileText; readonly label: string; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line-strong bg-paper px-2.5 text-xs font-medium text-ink-soft transition-colors duration-fast hover:border-ink hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
      {label}
    </button>
  );
}

// ─── Menu Favoris ─────────────────────────────────────────────────────────

function FavoritesMenu({
  orgId, mode, period, scope, onApply,
}: {
  readonly orgId: string;
  readonly mode: string;
  readonly period: PeriodValue;
  readonly scope?: Record<string, string | boolean>;
  readonly onApply: (fav: { period: PeriodValue; scope?: Record<string, string | boolean> }) => void;
}) {
  const favorites = useFavorites(orgId, mode);
  const add = useFavoritesStore((s) => s.add);
  const remove = useFavoritesStore((s) => s.remove);
  const [draft, setDraft] = useState('');

  return (
    <Popover
      label="Favoris"
      align="end"
      panelClassName="w-72"
      trigger={({ ref, onClick, ...aria }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          {...aria}
          className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line-strong bg-paper px-2.5 text-sm text-ink-soft transition-colors duration-fast hover:border-ink hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Star className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          Favoris
          {favorites.length > 0 && <span className="font-mono text-2xs text-ink-mute">{favorites.length}</span>}
        </button>
      )}
    >
      {() => (
        <div className="space-y-3">
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              add(orgId, mode, draft, period, scope);
              setDraft('');
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Nommer la sélection courante"
              aria-label="Nom du favori"
              className="h-8 flex-1 rounded-sm border border-line-strong bg-paper px-2 text-sm text-ink placeholder:text-ink-mute focus-visible:border-accent focus-visible:shadow-input focus-visible:outline-none"
            />
            <button
              type="submit"
              className="inline-flex h-8 items-center rounded-sm bg-accent px-2.5 text-xs font-medium text-paper hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Enregistrer
            </button>
          </form>
          {favorites.length === 0 ? (
            <p className="text-xs text-ink-mute">
              Aucun favori. Enregistrez une combinaison période + périmètre pour la rejouer.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {favorites.map((fav) => (
                <li key={fav.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onApply(fav)}
                    className="flex-1 rounded-sm px-2 py-1.5 text-left transition-colors duration-fast hover:bg-sunk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <span className="block text-sm text-ink">{fav.label}</span>
                    <span className="block font-mono text-2xs text-ink-mute">{summarizePeriod(fav.period)}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Supprimer le favori ${fav.label}`}
                    onClick={() => remove(orgId, mode, fav.id)}
                    className="rounded-sm p-1.5 text-ink-mute opacity-0 transition-opacity duration-fast hover:bg-critical-soft hover:text-critical-ink focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Popover>
  );
}

// ─── Menu Historique ──────────────────────────────────────────────────────

function HistoryMenu({
  orgId, mode, onApply,
}: {
  readonly orgId: string;
  readonly mode: string;
  readonly onApply: (run: { period: PeriodValue; scope?: Record<string, string | boolean> }) => void;
}) {
  const history = useHistory(orgId, mode);
  return (
    <Popover
      label="Historique des générations"
      align="end"
      panelClassName="w-72"
      trigger={({ ref, onClick, ...aria }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          {...aria}
          className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line-strong bg-paper px-2.5 text-sm text-ink-soft transition-colors duration-fast hover:border-ink hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <History className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          Récent
        </button>
      )}
    >
      {() =>
        history.length === 0 ? (
          <p className="text-xs text-ink-mute">Aucune génération récente sur cet état.</p>
        ) : (
          <ul className="space-y-0.5">
            {history.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => onApply(run)}
                  className="w-full rounded-sm px-2 py-1.5 text-left transition-colors duration-fast hover:bg-sunk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <span className="block font-mono text-sm tabular-nums text-ink">{summarizePeriod(run.period)}</span>
                  <span className="block text-2xs text-ink-mute">
                    {formatHuman(run.generatedAt.slice(0, 10))} · généré en{' '}
                    {(run.durationMs / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      }
    </Popover>
  );
}
