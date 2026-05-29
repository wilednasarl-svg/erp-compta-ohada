'use client';

/**
 * GenerationProgress — feedback de génération. L'interface actuelle ne montre
 * qu'un spinner anonyme ; un comptable ne sait pas si l'état met 1 s ou 20 s,
 * ni à quelle étape il en est. Ici : barre déterminée par étape + libellé de
 * l'étape courante + estimation restante. La barre s'anime par `transform`
 * (jamais `width`, cf. DESIGN.md) et respecte `prefers-reduced-motion`.
 */

import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Étapes types d'un état SYSCOHADA — réutilisables, libellés métier. */
export const GENERATION_STAGES: ReadonlyArray<string> = [
  'Agrégation des écritures committées',
  'Application de la hiérarchie SYSCOHADA',
  'Calcul des totaux et rattachement du résultat',
  'Mise en forme du document',
];

interface GenerationProgressProps {
  /** Progression 0 → 1. */
  readonly progress: number;
  /** Libellé de l'étape courante. */
  readonly stage: string;
  /** Estimation du temps restant en ms (optionnelle). */
  readonly etaMs?: number;
}

const formatEta = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 100) / 10);
  return s < 1 ? 'moins d’une seconde' : `~${s.toLocaleString('fr-FR')} s`;
};

export function GenerationProgress({ progress, stage, etaMs }: GenerationProgressProps) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm text-ink">
          <Loader2 className="h-4 w-4 animate-spin text-accent motion-reduce:animate-none" strokeWidth={1.5} aria-hidden />
          {stage}
        </span>
        <span className="font-mono text-xs tabular-nums text-ink-mute">
          {pct}%{etaMs !== undefined && pct < 100 ? ` · ${formatEta(etaMs)}` : ''}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-sunk"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progression de la génération"
      >
        <div
          className={cn(
            'h-full origin-left rounded-full bg-accent transition-transform duration-slow ease-out-quart',
            'motion-reduce:transition-none',
          )}
          style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }}
        />
      </div>
    </div>
  );
}
