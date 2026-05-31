import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * NextStep — a calm, directive cue telling the user the single thing to do now.
 *
 * Shown when a screen is empty or not yet configured, so a newcomer never
 * wonders "what do I do here". Full tinted surface with a leading arrow (no
 * banned side-stripe), a one-line instruction, and an optional primary action.
 */
export interface NextStepProps {
  /** The instruction, e.g. "Créez votre premier code de taux." */
  readonly children: ReactNode;
  /** Optional primary action (a Button, or a Link styled as one). */
  readonly action?: ReactNode;
  readonly className?: string;
}

export function NextStep({ children, action, className }: NextStepProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-accent/25 bg-accent-soft/55 px-4 py-3',
        className,
      )}
    >
      <ArrowRight className="h-4 w-4 shrink-0 text-accent-ink" strokeWidth={1.5} />
      <p className="flex-1 text-sm text-accent-ink">
        <span className="font-semibold">Prochaine étape : </span>
        {children}
      </p>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
