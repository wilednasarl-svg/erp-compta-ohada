'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Filtre de période partagé — paire de champs date (Du / Au) + raccourcis
 * d'exercice. Extrait pour mutualiser le filtre dupliqué dans chaque
 * panneau d'état (`/reports`) et offrir des presets cohérents partout.
 *
 * Composant contrôlé : le parent détient `fromDate`/`toDate` et reçoit les
 * nouvelles bornes via `onChange`. À placer à l'intérieur du `FilterGroup
 * title="Période"` existant — il ne rend que le contenu interne.
 */

interface PeriodRange {
  readonly fromDate: string;
  readonly toDate: string;
}

interface PeriodFilterProps {
  /** Préfixe unique pour les `id`/`htmlFor` (ex. « tb », « pl », « tft »). */
  readonly idPrefix: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly onChange: (next: PeriodRange) => void;
}

// ─── Helpers date (purs, locaux pour éviter le décalage UTC) ───────────

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Formate une `Date` en `YYYY-MM-DD` selon le fuseau local. */
const toIso = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

interface PeriodPreset {
  readonly key: string;
  readonly label: string;
  /** Calcule les bornes à partir d'une date de référence (défaut : maintenant). */
  readonly range: (ref?: Date) => PeriodRange;
}

/**
 * Raccourcis d'exercice ordonnés du plus fin au plus large. Chaque borne
 * est calculée à partir d'une date de référence injectable (testabilité).
 */
export const PERIOD_PRESETS: ReadonlyArray<PeriodPreset> = [
  {
    key: 'this-month',
    label: 'Ce mois',
    range: (ref = new Date()) => ({
      fromDate: toIso(new Date(ref.getFullYear(), ref.getMonth(), 1)),
      toDate: toIso(ref),
    }),
  },
  {
    key: 'last-month',
    label: 'Mois dernier',
    range: (ref = new Date()) => ({
      fromDate: toIso(new Date(ref.getFullYear(), ref.getMonth() - 1, 1)),
      // Jour 0 du mois courant = dernier jour du mois précédent.
      toDate: toIso(new Date(ref.getFullYear(), ref.getMonth(), 0)),
    }),
  },
  {
    key: 'this-quarter',
    label: 'Ce trimestre',
    range: (ref = new Date()) => ({
      fromDate: toIso(new Date(ref.getFullYear(), Math.floor(ref.getMonth() / 3) * 3, 1)),
      toDate: toIso(ref),
    }),
  },
  {
    key: 'this-year',
    label: 'Cet exercice',
    range: (ref = new Date()) => ({
      fromDate: `${ref.getFullYear()}-01-01`,
      toDate: toIso(ref),
    }),
  },
  {
    key: 'prev-year',
    label: 'Exercice N-1',
    range: (ref = new Date()) => ({
      fromDate: `${ref.getFullYear() - 1}-01-01`,
      toDate: `${ref.getFullYear() - 1}-12-31`,
    }),
  },
];

export function PeriodFilter({ idPrefix, fromDate, toDate, onChange }: PeriodFilterProps) {
  const applyPreset = (preset: PeriodPreset): void => {
    onChange(preset.range());
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label
            htmlFor={`${idPrefix}-from`}
            className="text-2xs uppercase tracking-wider text-ink-soft"
          >
            Du
          </Label>
          <Input
            id={`${idPrefix}-from`}
            type="date"
            value={fromDate}
            onChange={(e) => onChange({ fromDate: e.target.value, toDate })}
            required
            className="h-9 w-40 font-mono tabular-nums"
          />
        </div>
        <div className="space-y-1">
          <Label
            htmlFor={`${idPrefix}-to`}
            className="text-2xs uppercase tracking-wider text-ink-soft"
          >
            Au
          </Label>
          <Input
            id={`${idPrefix}-to`}
            type="date"
            value={toDate}
            onChange={(e) => onChange({ fromDate, toDate: e.target.value })}
            required
            className="h-9 w-40 font-mono tabular-nums"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Raccourcis de période">
        {PERIOD_PRESETS.map((preset) => {
          const { fromDate: pFrom, toDate: pTo } = preset.range();
          const isActive = pFrom === fromDate && pTo === toDate;
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyPreset(preset)}
              aria-pressed={isActive}
              className={cn(
                'rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                isActive
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'border-line-strong bg-paper text-ink-soft hover:border-ink hover:bg-sunk hover:text-ink',
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
