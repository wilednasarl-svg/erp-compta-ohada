'use client';

import { GraduationCap, Info, Lightbulb, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Hint — a contextual learning callout that teaches the new user without
 * nagging the expert. Dismissals persist in localStorage by `id`, so a
 * junior who closes a hint never sees it again. Full tinted surface with a
 * soft border (no banned side-stripe), an explanatory icon, and concise copy.
 */
type Variant = 'learn' | 'info' | 'tip';

const VARIANTS: Record<Variant, { icon: LucideIcon; surface: string; iconColor: string }> = {
  learn: {
    icon: GraduationCap,
    surface: 'border-accent/20 bg-accent-soft/60',
    iconColor: 'text-accent-ink',
  },
  info: {
    icon: Info,
    surface: 'border-info/20 bg-info-soft/60',
    iconColor: 'text-info-ink',
  },
  tip: {
    icon: Lightbulb,
    surface: 'border-warn/25 bg-warn-soft/50',
    iconColor: 'text-warn-ink',
  },
};

const STORAGE_PREFIX = 'hint-dismissed:';

export interface HintProps {
  /**
   * Stable identifier. When set, the hint can be dismissed permanently and
   * its closed state is remembered across sessions. Omit for a non-dismissible
   * permanent hint.
   */
  readonly id?: string;
  readonly variant?: Variant;
  readonly title?: string;
  readonly children: ReactNode;
  /** Optional inline action (e.g. a "Voir le guide" link). */
  readonly action?: ReactNode;
  readonly className?: string;
}

export function Hint({
  id,
  variant = 'learn',
  title,
  children,
  action,
  className,
}: HintProps) {
  const dismissible = typeof id === 'string';
  const [hidden, setHidden] = useState(false);
  const [ready, setReady] = useState(!dismissible);

  useEffect(() => {
    if (!dismissible) return;
    try {
      if (localStorage.getItem(STORAGE_PREFIX + id) === '1') {
        setHidden(true);
      }
    } catch {
      /* localStorage unavailable (private mode) — show the hint */
    }
    setReady(true);
  }, [dismissible, id]);

  const dismiss = (): void => {
    setHidden(true);
    if (!dismissible) return;
    try {
      localStorage.setItem(STORAGE_PREFIX + id, '1');
    } catch {
      /* ignore persistence failure */
    }
  };

  if (!ready || hidden) return null;

  const { icon: Icon, surface, iconColor } = VARIANTS[variant];

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-md border px-4 py-3 text-sm',
        surface,
        className,
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconColor)} strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-ink">{title}</p>}
        <div className={cn('leading-relaxed text-ink-soft', title && 'mt-0.5')}>
          {children}
        </div>
        {action && <div className="mt-2">{action}</div>}
      </div>
      {dismissible && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Masquer ce conseil"
          className="-mr-1 -mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink-mute transition-colors duration-fast hover:bg-paper hover:text-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}
