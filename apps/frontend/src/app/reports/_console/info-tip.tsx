'use client';

/**
 * InfoTip — bulle d'aide accessible, remplaçant les `title=` natifs disséminés
 * dans /reports. Un `title` n'est ni focusable, ni lisible au lecteur d'écran
 * de façon fiable, ni stylable. Ici : déclenchement hover + focus clavier,
 * fermeture Échap, contenu riche, `aria-describedby` correct.
 *
 * Usage : <InfoTip label="Aide sur l'arrêté">Le résultat net…</InfoTip>
 */

import { HelpCircle } from 'lucide-react';
import { useId, useState } from 'react';

import { cn } from '@/lib/utils';

interface InfoTipProps {
  readonly children: React.ReactNode;
  /** Texte du bouton pour les lecteurs d'écran (ex. « Aide sur la période »). */
  readonly label: string;
  readonly className?: string;
}

export function InfoTip({ children, label, className }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className={cn('relative inline-flex', className)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-mute transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        <HelpCircle className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-[calc(100%+6px)] left-1/2 z-50 w-64 -translate-x-1/2 rounded-md border border-line bg-paper p-2.5 text-xs leading-snug text-ink-soft shadow-pop animate-fade-in"
        >
          {children}
        </span>
      )}
    </span>
  );
}
