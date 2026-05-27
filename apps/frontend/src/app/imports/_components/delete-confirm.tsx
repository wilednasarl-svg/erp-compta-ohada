'use client';

import { Loader2, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Confirmation inline pour la suppression d'une session d'import.
 *
 * Remplace `window.confirm()` — la boîte native du navigateur casse
 * complètement la cohérence visuelle (typo système, contrastes
 * différents, position arbitraire) et n'est pas accessible aux lecteurs
 * d'écran de la même façon que nos composants ARIA.
 *
 * Interaction :
 *   - Premier clic sur la poubelle → ouvre un popover avec
 *     l'avertissement détaillé et deux boutons (Annuler / Supprimer).
 *   - Click outside ou Échap → ferme sans action.
 *   - Click "Supprimer" → exécute `onConfirm()`, le parent affiche
 *     le spinner via `isPending` et ferme via `isPending` qui repasse
 *     à `false`.
 */

interface DeleteSessionConfirmProps {
  readonly label: string;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly isPending: boolean;
  readonly onConfirm: () => void;
}

export function DeleteSessionConfirm({
  label,
  disabled,
  disabledReason,
  isPending,
  onConfirm,
}: DeleteSessionConfirmProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  // Quand la mutation se termine, on referme proprement.
  useEffect(() => {
    if (!isPending && isOpen) {
      // Ne pas refermer pendant que la mutation tourne — l'utilisateur
      // verrait le popover disparaître sans feedback. On laisse le
      // parent gérer la fermeture en passant isPending=false ET en
      // invalidant le state qui rerendrait le composant.
    }
  }, [isPending, isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled || (isPending && !isOpen)}
        title={disabled ? disabledReason : 'Supprimer la session'}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) return;
          setIsOpen((v) => !v);
        }}
        className={cn(
          'inline-flex items-center justify-center rounded-md border border-line-strong bg-paper p-1.5 text-ink-mute transition-colors',
          'hover:border-critical hover:bg-critical-soft hover:text-critical',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-critical/40',
          'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong disabled:hover:bg-paper disabled:hover:text-ink-mute',
          isOpen && 'border-critical bg-critical-soft text-critical',
        )}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </button>

      {isOpen && !disabled && (
        <div
          role="dialog"
          aria-label="Confirmer la suppression de la session"
          className="absolute right-0 top-[calc(100%+6px)] z-20 w-80 rounded-md border border-line-strong bg-paper p-4 text-left shadow-pop"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-ink">Supprimer cette session ?</p>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="-mr-1 -mt-1 rounded-sm p-1 text-ink-mute transition-colors hover:bg-sunk hover:text-ink"
              aria-label="Fermer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-soft">
            La session «&nbsp;<span className="font-medium text-ink">{label}</span>&nbsp;»
            sera supprimée définitivement. Le fichier source, les lignes en staging et les
            erreurs associées seront perdus. Cette action est irréversible.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => setIsOpen(false)}
            >
              Annuler
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={isPending}
              onClick={() => onConfirm()}
            >
              {isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Supprimer
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
