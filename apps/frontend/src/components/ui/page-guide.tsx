'use client';

import { ChevronDown, GraduationCap, ListChecks, BookMarked } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * PageGuide — an on-demand, per-screen "how to use this page" panel.
 *
 * Three things a newcomer to an OHADA accounting tool needs, in one place,
 * folded away until wanted (so it never adds clutter to the expert's view):
 *   1. Purpose      — what this screen is for, in one or two sentences.
 *   2. Steps        — the concrete first actions, numbered.
 *   3. Glossary     — the OHADA terms on this screen, explained plainly.
 *
 * Open state persists per `id`: a junior who keeps it open sees it next time,
 * an expert who collapses it never fights it again. Defaults to open so a
 * first-time user is guided, expanded copy reduces cognitive load.
 */
export interface PageGuideStep {
  readonly title: string;
  readonly detail?: ReactNode;
}

export interface GlossaryTerm {
  readonly term: string;
  readonly definition: ReactNode;
}

export interface PageGuideProps {
  /** Stable id; persists the open/closed choice across sessions. */
  readonly id: string;
  /** What this page is for. */
  readonly purpose: ReactNode;
  /** Concrete steps to use the page. */
  readonly steps?: ReadonlyArray<PageGuideStep>;
  /** OHADA / accounting terms used on this page. */
  readonly glossary?: ReadonlyArray<GlossaryTerm>;
  /** Start expanded on first visit. Defaults to true (guide the newcomer). */
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

const STORAGE_PREFIX = 'page-guide-open:';

export function PageGuide({
  id,
  purpose,
  steps,
  glossary,
  defaultOpen = true,
  className,
}: PageGuideProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_PREFIX + id);
      if (saved !== null) setOpen(saved === '1');
    } catch {
      /* localStorage unavailable — keep default */
    }
    setReady(true);
  }, [id]);

  const toggle = (): void => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_PREFIX + id, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const panelId = `page-guide-${id}`;

  return (
    <section
      className={cn('overflow-hidden rounded-md border border-line bg-paper', className)}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={ready ? open : defaultOpen}
        aria-controls={panelId}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors duration-fast hover:bg-sunk/50"
      >
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-accent-ink">
          <GraduationCap className="h-4 w-4" strokeWidth={1.5} />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-medium text-ink">Comment utiliser cette page</span>
          <span className="block text-xs text-ink-mute">
            À quoi elle sert, comment faire, et les termes utiles
          </span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-ink-mute transition-transform duration-base',
            open && 'rotate-180',
          )}
          strokeWidth={1.5}
        />
      </button>

      {open && (
        <div id={panelId} className="border-t border-line px-4 py-4">
          <p className="max-w-[68ch] text-sm leading-relaxed text-ink-soft">{purpose}</p>

          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            {steps && steps.length > 0 && (
              <div>
                <h3 className="mb-2.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-mute">
                  <ListChecks className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Comment faire
                </h3>
                <ol className="space-y-2.5">
                  {steps.map((step, i) => (
                    <li key={step.title} className="flex gap-2.5">
                      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunk text-2xs font-medium text-ink-soft">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{step.title}</p>
                        {step.detail && (
                          <p className="mt-0.5 text-xs leading-relaxed text-ink-mute">
                            {step.detail}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {glossary && glossary.length > 0 && (
              <div>
                <h3 className="mb-2.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-mute">
                  <BookMarked className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Lexique
                </h3>
                <dl className="space-y-2.5">
                  {glossary.map((entry) => (
                    <div key={entry.term}>
                      <dt className="text-sm font-medium text-ink">{entry.term}</dt>
                      <dd className="mt-0.5 text-xs leading-relaxed text-ink-mute">
                        {entry.definition}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
