'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Term — an inline OHADA term that reveals its definition on hover or focus.
 *
 * Brings the page glossary to the place the word is actually used: a junior
 * reading "lettrage" or "contre-passation" in context gets the meaning without
 * leaving the screen. A dotted underline signals it is explainable; the tooltip
 * stays hidden (no clutter) until wanted, and is reachable by keyboard.
 */
export interface TermProps {
  readonly children: ReactNode;
  /** Short, plain definition shown in the tooltip. */
  readonly def: ReactNode;
  readonly className?: string;
}

export function Term({ children, def, className }: TermProps) {
  return (
    <span
      tabIndex={0}
      className={cn(
        'group relative inline-flex cursor-help border-b border-dotted border-ink-mute/70',
        'outline-none focus-visible:border-accent',
        className,
      )}
    >
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-max max-w-[18rem]',
          '-translate-x-1/2 rounded-md border border-line bg-paper px-3 py-2',
          'text-left text-xs font-normal leading-relaxed text-ink-soft shadow-pop',
          'group-hover:block group-focus-visible:block',
        )}
      >
        {def}
      </span>
    </span>
  );
}
