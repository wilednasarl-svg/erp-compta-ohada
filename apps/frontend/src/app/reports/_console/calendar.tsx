'use client';

/**
 * Calendrier mensuel compact, sans dépendance (pas de react-day-picker).
 * Supporte la sélection simple (`single`) et de plage (`range`), avec
 * navigation clavier complète (flèches = ±1 jour / ±1 semaine, Origine/Fin
 * = bornes de semaine, Entrée = sélection). Semaine débutant le lundi,
 * conforme à l'usage FR-CI.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { fromIso, toIso } from './presets';

const WEEKDAYS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

interface BaseProps {
  /** Mois initialement visible (ISO d'un jour quelconque du mois). */
  readonly initialMonth?: string;
}

interface SingleProps extends BaseProps {
  readonly mode: 'single';
  readonly selected: string;
  readonly onSelect: (iso: string) => void;
}

interface RangeProps extends BaseProps {
  readonly mode: 'range';
  readonly start: string;
  readonly end: string;
  readonly onRangeChange: (next: { start: string; end: string }) => void;
}

type CalendarProps = SingleProps | RangeProps;

const addDays = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);

/** Index 0=lundi … 6=dimanche. */
const mondayIndex = (d: Date): number => (d.getDay() + 6) % 7;

export function Calendar(props: CalendarProps) {
  const anchorIso = props.mode === 'single' ? props.selected : props.start;
  const [view, setView] = useState<Date>(() =>
    fromIso(props.initialMonth ?? anchorIso ?? toIso(new Date())),
  );
  const [focusIso, setFocusIso] = useState<string>(anchorIso ?? toIso(new Date()));
  const gridRef = useRef<HTMLDivElement>(null);
  const shouldFocusRef = useRef(false);

  // Première case de la grille : le lundi de la semaine du 1er du mois.
  const firstOfMonth = new Date(view.getFullYear(), view.getMonth(), 1, 12);
  const gridStart = addDays(firstOfMonth, -mondayIndex(firstOfMonth));
  const days: Date[] = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  useEffect(() => {
    if (shouldFocusRef.current) {
      const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focusIso}"]`);
      el?.focus();
      shouldFocusRef.current = false;
    }
  }, [focusIso, view]);

  const moveFocus = (deltaDays: number): void => {
    const next = toIso(addDays(fromIso(focusIso), deltaDays));
    const nextDate = fromIso(next);
    if (nextDate.getMonth() !== view.getMonth() || nextDate.getFullYear() !== view.getFullYear()) {
      setView(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1, 12));
    }
    shouldFocusRef.current = true;
    setFocusIso(next);
  };

  const selectDay = (iso: string): void => {
    if (props.mode === 'single') {
      props.onSelect(iso);
      return;
    }
    // Range : borne basse posée mais haute vide → on complète (en ordonnant) ;
    // sinon (rien encore, ou plage déjà complète) → on (re)pose la borne basse.
    const { start, end } = props;
    if (start && !end) {
      const lo = iso < start ? iso : start;
      const hi = iso < start ? start : iso;
      props.onRangeChange({ start: lo, end: hi });
    } else {
      props.onRangeChange({ start: iso, end: '' });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); moveFocus(-1); break;
      case 'ArrowRight': e.preventDefault(); moveFocus(1); break;
      case 'ArrowUp': e.preventDefault(); moveFocus(-7); break;
      case 'ArrowDown': e.preventDefault(); moveFocus(7); break;
      case 'Home': e.preventDefault(); moveFocus(-mondayIndex(fromIso(focusIso))); break;
      case 'End': e.preventDefault(); moveFocus(6 - mondayIndex(fromIso(focusIso))); break;
      case 'Enter':
      case ' ': e.preventDefault(); selectDay(focusIso); break;
      default: break;
    }
  };

  const isSelected = (iso: string): boolean =>
    props.mode === 'single'
      ? iso === props.selected
      : iso === props.start || iso === props.end;

  const inRange = (iso: string): boolean =>
    props.mode === 'range' &&
    Boolean(props.start) &&
    Boolean(props.end) &&
    iso > props.start &&
    iso < props.end;

  const todayIso = toIso(new Date());

  return (
    <div className="w-[252px] select-none">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Mois précédent"
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1, 12))}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-ink-soft transition-colors duration-fast hover:bg-sunk hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <p className="text-sm font-medium capitalize text-ink" aria-live="polite">
          {MONTHS[view.getMonth()]} {view.getFullYear()}
        </p>
        <button
          type="button"
          aria-label="Mois suivant"
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1, 12))}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-ink-soft transition-colors duration-fast hover:bg-sunk hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5" aria-hidden>
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1 text-center text-2xs uppercase tracking-wider text-ink-mute">
            {w}
          </div>
        ))}
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label="Calendrier"
        className="grid grid-cols-7 gap-0.5"
        onKeyDown={onKeyDown}
      >
        {days.map((day) => {
          const iso = toIso(day);
          const outside = day.getMonth() !== view.getMonth();
          const selected = isSelected(iso);
          const ranged = inRange(iso);
          const isToday = iso === todayIso;
          const isFocusTarget = iso === focusIso;
          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              data-iso={iso}
              tabIndex={isFocusTarget ? 0 : -1}
              aria-selected={selected}
              aria-current={isToday ? 'date' : undefined}
              onClick={() => {
                setFocusIso(iso);
                selectDay(iso);
              }}
              className={cn(
                'relative h-8 rounded-sm font-mono text-xs tabular-nums transition-colors duration-fast',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                outside ? 'text-ink-mute/50' : 'text-ink',
                !selected && !ranged && 'hover:bg-sunk',
                ranged && 'bg-accent-soft text-accent-ink',
                selected && 'bg-accent font-medium text-paper hover:bg-accent',
              )}
            >
              {day.getDate()}
              {isToday && !selected && (
                <span className="absolute inset-x-[40%] bottom-1 h-0.5 rounded-full bg-accent" aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
