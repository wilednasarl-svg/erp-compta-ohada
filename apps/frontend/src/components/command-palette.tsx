'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { NAV_FLAT } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * Lightweight command palette — no `cmdk` dependency. Triggers on ⌘K / Ctrl+K.
 * Filters the flat nav model, groups results by domain, supports keyboard
 * navigation (↑ ↓ Enter Esc). Visual treatment matches the editorial
 * paper-ivory direction: popover surface, soft shadow, tabular kbd hints.
 */
interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (q.length === 0) return NAV_FLAT;
    return NAV_FLAT.filter(
      (item) =>
        normalize(item.label).includes(q) ||
        normalize(item.group).includes(q) ||
        (item.hint ? normalize(item.hint).includes(q) : false),
    );
  }, [query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // Defer focus until popover is mounted
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep the active row visible
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLLIElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const handleSelect = useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const target = filtered[activeIndex];
        if (target) handleSelect(target.href);
      }
    },
    [activeIndex, filtered, handleSelect, onOpenChange],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Recherche rapide"
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 px-4 pt-[10vh] animate-fade-in"
      onClick={() => onOpenChange(false)}
      onKeyDown={onKeyDown}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-line-strong bg-paper shadow-modal animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-4 w-4 text-ink-mute" strokeWidth={1.5} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Aller à… plan comptable, TVA, lettrage"
            className="h-12 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-mute focus:outline-none"
            aria-label="Rechercher une page"
          />
          <kbd className="hidden rounded-xs border border-line-strong bg-sunk px-1.5 py-0.5 text-2xs text-ink-mute sm:inline-block">
            ESC
          </kbd>
        </div>

        <ul
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto py-1"
          role="listbox"
          aria-label="Résultats"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-ink-mute">
              Aucune correspondance.
            </li>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon;
              const active = index === activeIndex;
              return (
                <li
                  key={item.href}
                  data-index={index}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => handleSelect(item.href)}
                  className={cn(
                    'mx-1 flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors duration-fast',
                    active ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-sunk',
                  )}
                >
                  <Icon
                    className={cn('h-4 w-4 shrink-0', active ? 'text-accent-ink' : 'text-ink-mute')}
                    strokeWidth={1.5}
                  />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.hint ? (
                    <span className="hidden text-2xs uppercase tracking-wider text-ink-mute sm:inline">
                      {item.hint}
                    </span>
                  ) : null}
                  <span className="text-2xs uppercase tracking-wider text-ink-mute">
                    {item.group}
                  </span>
                </li>
              );
            })
          )}
        </ul>

        <div className="flex items-center justify-between border-t border-line bg-sunk/40 px-4 py-2 text-2xs uppercase tracking-wider text-ink-mute">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              naviguer
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd>
              ouvrir
            </span>
          </span>
          <span>{filtered.length} résultats</span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded-xs border border-line-strong bg-paper px-1 font-mono text-[10px] text-ink-soft">
      {children}
    </kbd>
  );
}

/**
 * `useCommandPalette` — wires ⌘K / Ctrl+K and exposes open/close state.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isModK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isModK) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { open, setOpen };
}
