import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * EmptyState — a *teaching* empty surface, not a "nothing here" shrug.
 *
 * The first time an accountant opens a module it should explain what the
 * module does and offer the obvious first action. No generic illustrations
 * (banned): a tinted icon medallion, a clear title, one explanatory line,
 * an optional primary action, and optional "what you can do here" bullets.
 */
type Tone = 'neutral' | 'accent' | 'info' | 'warn' | 'critical';

const TONE_MEDALLION: Record<Tone, string> = {
  neutral: 'bg-sunk text-ink-soft border-line',
  accent: 'bg-accent-soft text-accent-ink border-accent/15',
  info: 'bg-info-soft text-info-ink border-info/15',
  warn: 'bg-warn-soft text-warn-ink border-warn/20',
  critical: 'bg-critical-soft text-critical-ink border-critical/15',
};

export interface EmptyStateProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description?: ReactNode;
  /** Visual tone of the medallion. Defaults to the validation accent. */
  readonly tone?: Tone;
  /** Primary call to action (a Button, a Link rendered as button, etc.). */
  readonly action?: ReactNode;
  /** Secondary action, shown beside the primary one. */
  readonly secondaryAction?: ReactNode;
  /** Short bullet list of what the user can accomplish in this module. */
  readonly tips?: ReadonlyArray<string>;
  readonly className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  tone = 'accent',
  action,
  secondaryAction,
  tips,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-lg border border-line bg-paper px-6 py-12 text-center',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-flex h-14 w-14 items-center justify-center rounded-xl border',
          TONE_MEDALLION[tone],
        )}
      >
        <Icon className="h-6 w-6" strokeWidth={1.5} />
      </span>

      <h3 className="mt-5 text-base font-semibold text-ink">{title}</h3>

      {description && (
        <p className="mt-1.5 max-w-[46ch] text-sm leading-relaxed text-ink-soft">
          {description}
        </p>
      )}

      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}

      {tips && tips.length > 0 && (
        <ul className="mt-6 w-full max-w-sm space-y-2 border-t border-line pt-5 text-left">
          {tips.map((tip) => (
            <li key={tip} className="flex items-start gap-2.5 text-xs text-ink-soft">
              <span
                aria-hidden
                className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-accent"
              />
              <span className="leading-relaxed">{tip}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
