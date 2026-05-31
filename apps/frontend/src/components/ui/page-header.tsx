import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * PageHeader — the consistent top of every authenticated page.
 *
 * One vocabulary for the whole app: domain eyebrow, editorial serif title,
 * a soft subtitle that explains the page in one sentence (lowers cognitive
 * load for first-time users), and a right-aligned actions slot.
 *
 * Layout follows DESIGN.md: eyebrow (2xs uppercase) · h1 Fraunces · subtitle
 * ink-soft capped at a readable measure. No card, no container chrome.
 */
export interface PageHeaderProps {
  /** Microlabel above the title, usually the functional domain. */
  readonly eyebrow?: string;
  /** Page title — rendered in the editorial serif. */
  readonly title: string;
  /** One-sentence explanation of what this page is for. */
  readonly subtitle?: ReactNode;
  /** Optional leading icon, shown in a tinted medallion beside the title. */
  readonly icon?: LucideIcon;
  /** Right-aligned actions (buttons, filters). */
  readonly actions?: ReactNode;
  /** Extra content below the header row (hints, tabs, summary chips). */
  readonly children?: ReactNode;
  readonly className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('mb-6 sm:mb-8', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          {Icon && (
            <span
              aria-hidden
              className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-paper text-accent-ink sm:inline-flex"
            >
              <Icon className="h-5 w-5" strokeWidth={1.5} />
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && (
              <p className="eyebrow mb-1.5 flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-1 w-1 rounded-full bg-accent"
                />
                {eyebrow}
              </p>
            )}
            <h1 className="font-display text-3xl leading-tight">{title}</h1>
            {subtitle && (
              <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-ink-soft">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>

      {children && <div className="mt-5">{children}</div>}
    </header>
  );
}
