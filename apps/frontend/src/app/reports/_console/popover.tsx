'use client';

/**
 * Popover ancré minimal — le kit UI n'embarque pas Radix Popover et tirer
 * une dépendance pour ce besoin serait disproportionné (budget bundle < 200 kb
 * sur les routes critiques, cf. PRODUCT.md). Ce composant couvre le strict
 * nécessaire : ouverture contrôlée, fermeture au clic extérieur + Échap,
 * focus renvoyé au déclencheur, panneau flottant `shadow-pop`.
 *
 * Volontairement non générique : un seul alignement (sous le déclencheur,
 * aligné à gauche ou à droite). Suffit pour le champ de période, les favoris
 * et l'historique.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface PopoverProps {
  readonly trigger: (props: {
    readonly 'aria-expanded': boolean;
    readonly 'aria-haspopup': 'dialog';
    readonly onClick: () => void;
    readonly ref: React.RefObject<HTMLButtonElement | null>;
  }) => React.ReactNode;
  readonly children: (close: () => void) => React.ReactNode;
  readonly align?: 'start' | 'end';
  /** Largeur du panneau en pixels (défaut auto via classe). */
  readonly panelClassName?: string;
  readonly label: string;
}

export function Popover({ trigger, children, align = 'start', panelClassName, label }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;

    const onPointer = (e: PointerEvent): void => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block">
      {trigger({
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        onClick: () => setOpen((v) => !v),
        ref: triggerRef,
      })}
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={label}
          className={cn(
            'absolute top-[calc(100%+6px)] z-50 rounded-md border border-line bg-paper p-3 shadow-pop',
            'animate-fade-in-up',
            align === 'end' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
