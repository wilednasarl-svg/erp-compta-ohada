'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { SessionSummary } from '@/types/imports';

/**
 * Visible 4-step pipeline indicator pour /imports.
 *
 * Le statut technique côté backend (`draft | parsing | parsed | validated |
 * ready_for_import | completed | failed`) n'a pas de valeur pédagogique
 * pour un comptable qui découvre l'écran. On le projette sur 4 phases
 * métier :
 *
 *   1. Préparer       — la session existe, on attend un fichier
 *   2. Fichier reçu   — parsing terminé, lignes en staging
 *   3. Vérifié        — colonnes mappées, lignes contrôlées, prêt à committer
 *   4. Au journal     — écritures comptables persistées
 *
 * Le statut `failed` casse la frise et s'affiche en bandeau rouge plein —
 * l'utilisateur doit le voir, pas le chercher.
 */

type Phase = 'prepare' | 'received' | 'verified' | 'journal';

const PHASE_ORDER: ReadonlyArray<Phase> = ['prepare', 'received', 'verified', 'journal'];

const PHASE_LABEL: Record<Phase, string> = {
  prepare: 'Préparer',
  received: 'Fichier reçu',
  verified: 'Vérifié',
  journal: 'Au journal',
};

const PHASE_HINT: Record<Phase, string> = {
  prepare: 'Choisir le type de document et le format du fichier source.',
  received: 'Le fichier a été ingéré. Lecture des lignes en cours ou prêtes à mapper.',
  verified: 'Les colonnes sont reconnues et les lignes contrôlées. Plus aucune erreur.',
  journal: 'Les écritures sont passées au journal comptable. Action irréversible.',
};

const STATUS_TO_PHASE: Record<SessionSummary['status'], Phase> = {
  draft: 'prepare',
  parsing: 'received',
  parsed: 'received',
  validated: 'verified',
  ready_for_import: 'verified',
  completed: 'journal',
  // failed n'est pas une phase — géré séparément
  failed: 'prepare',
};

interface PipelineStepperProps {
  readonly status: SessionSummary['status'];
  readonly errorLines: number;
}

export function PipelineStepper({ status, errorLines }: PipelineStepperProps) {
  if (status === 'failed') {
    return (
      <div
        role="status"
        className="rounded-md border border-critical/30 bg-critical-soft px-4 py-3 text-sm text-critical-ink"
      >
        <p className="font-medium">Échec de la session</p>
        <p className="mt-0.5 text-xs">
          Le pipeline s&apos;est arrêté avant la validation. Consulter le détail ci-dessous,
          corriger le fichier source, puis créer une nouvelle session.
        </p>
      </div>
    );
  }

  const currentPhase = STATUS_TO_PHASE[status];
  const currentIndex = PHASE_ORDER.indexOf(currentPhase);
  // Une session committée occupe la phase 4 et est considérée terminée.
  const isCompleted = status === 'completed';

  return (
    <div className="rounded-md border border-line bg-paper">
      <ol className="grid grid-cols-1 sm:grid-cols-4">
        {PHASE_ORDER.map((phase, idx) => {
          const isDone = isCompleted || idx < currentIndex;
          const isCurrent = !isCompleted && idx === currentIndex;
          // L'étape "Vérifié" passe en warn si des lignes restent en erreur,
          // pour ne pas afficher un vert mensonger.
          const verifiedWithErrors = isCurrent && phase === 'verified' && errorLines > 0;

          return (
            <li
              key={phase}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'relative flex items-start gap-3 border-line px-4 py-3 sm:flex-col sm:items-start sm:gap-1.5',
                idx < PHASE_ORDER.length - 1 && 'sm:border-r',
                idx > 0 && 'border-t sm:border-t-0',
              )}
            >
              <div className="flex items-center gap-3 sm:gap-2">
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-xs tabular-nums transition-colors',
                    isDone && 'bg-accent text-paper',
                    isCurrent && !verifiedWithErrors && 'border border-accent bg-accent-soft text-accent-ink',
                    verifiedWithErrors && 'border border-warn bg-warn-soft text-warn-ink',
                    !isDone && !isCurrent && 'border border-line-strong bg-sunk text-ink-mute',
                  )}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : idx + 1}
                </span>
                <div className="min-w-0 flex-1 sm:flex-none">
                  <p
                    className={cn(
                      'text-2xs uppercase tracking-wider',
                      isCurrent || isDone ? 'text-ink' : 'text-ink-mute',
                    )}
                  >
                    Étape {idx + 1}
                  </p>
                  <p
                    className={cn(
                      'text-sm font-medium leading-tight',
                      isCurrent || isDone ? 'text-ink' : 'text-ink-mute',
                    )}
                  >
                    {PHASE_LABEL[phase]}
                  </p>
                </div>
              </div>
              <p
                className={cn(
                  'mt-0 max-w-[28ch] text-xs leading-snug sm:mt-0.5',
                  isCurrent ? 'text-ink-soft' : 'text-ink-mute',
                )}
              >
                {verifiedWithErrors
                  ? `${errorLines} ligne(s) en erreur à corriger avant le commit.`
                  : PHASE_HINT[phase]}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
