'use client';

import { Loader2, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DeleteSessionConfirmProps {
  readonly label: string;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly isPending: boolean;
  readonly onConfirm: () => void;
}

/**
 * Popover de confirmation de suppression rendu via createPortal.
 * Le portal évite que le popover soit clippé par overflow:hidden des
 * conteneurs parents (liste, section, carte).
 */
export function DeleteSessionConfirm({
  label,
  disabled,
  disabledReason,
  isPending,
  onConfirm,
}: DeleteSessionConfirmProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const openPopover = () => {
    if (disabled) return;
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }
    setIsOpen((v) => !v);
  };

  /* Close on outside pointer down */
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current && triggerRef.current.contains(target)) return;
      // Le popover est rendu via createPortal dans document.body : sans cette
      // exception, le pointerdown sur « Supprimer » fermerait le popover avant
      // que le click n'aboutisse, et onConfirm ne serait jamais appelé.
      if (popoverRef.current && popoverRef.current.contains(target)) return;
      setIsOpen(false);
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

  /* Reposition on scroll/resize while open */
  useEffect(() => {
    if (!isOpen) return;
    const update = () => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
      }
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || (isPending && !isOpen)}
        title={disabled ? disabledReason : 'Supprimer la session'}
        onClick={openPopover}
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

      {isOpen && pos && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Confirmer la suppression de la session"
          style={{ top: pos.top, right: pos.right, position: 'fixed', zIndex: 200 }}
          className="w-80 rounded-md border border-line-strong bg-paper p-4 text-left shadow-xl"
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
            La session&nbsp;«&nbsp;<span className="font-medium text-ink">{label}</span>&nbsp;»
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
              onClick={() => {
                setIsOpen(false);
                onConfirm();
              }}
            >
              {isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Supprimer
            </Button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
