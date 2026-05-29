/**
 * Report Console — helpers de date purs + presets de période.
 *
 * Aucune dépendance externe (pas de date-fns) : les bornes sont calculées
 * en fuseau local pour éviter le décalage UTC qui décale un arrêté du 31/12
 * au 30/12. Toutes les fonctions acceptent une date de référence injectable
 * pour rester testables sans geler l'horloge.
 */

import type { AsAtValue, PeriodKind, PeriodValue, RangeValue } from './types';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Formate une `Date` en `YYYY-MM-DD` (fuseau local). */
export const toIso = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Parse `YYYY-MM-DD` en `Date` locale à midi (évite les bascules de fuseau). */
export const fromIso = (iso: string): Date => {
  const [y, m, d] = iso.split('-');
  return new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0, 0);
};

export const todayIso = (ref: Date = new Date()): string => toIso(ref);
export const yearStartIso = (ref: Date = new Date()): string => `${ref.getFullYear()}-01-01`;
export const previousYearEndIso = (ref: Date = new Date()): string =>
  `${ref.getFullYear() - 1}-12-31`;
export const previousYearStartIso = (ref: Date = new Date()): string =>
  `${ref.getFullYear() - 1}-01-01`;

/** Dernier jour du mois précédent celui de `ref`. */
const lastDayPrevMonthIso = (ref: Date): string =>
  toIso(new Date(ref.getFullYear(), ref.getMonth(), 0));

// ─── Formatage lisible (FR-CI) ─────────────────────────────────────────

const FR_MONTHS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
];

/** « 31 déc. 2025 » — format compact pour chips et résumés. */
export const formatHuman = (iso: string): string => {
  const d = fromIso(iso);
  return `${d.getDate()} ${FR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

/** Résumé d'une période, indépendant de sa sémantique. */
export const summarizePeriod = (value: PeriodValue): string =>
  value.kind === 'range'
    ? `${formatHuman(value.fromDate)} → ${formatHuman(value.toDate)}`
    : `Arrêté au ${formatHuman(value.asAtDate)}`;

// ─── Presets ────────────────────────────────────────────────────────────

export interface PeriodPreset {
  readonly key: string;
  readonly label: string;
  /** Sous-titre optionnel (ex. les bornes résolues), affiché en mute. */
  readonly describe?: (ref: Date) => string;
  readonly resolve: (ref: Date) => PeriodValue;
}

/** Presets de plage Du / Au, du plus fin au plus large. */
export const RANGE_PRESETS: ReadonlyArray<PeriodPreset> = [
  {
    key: 'this-month',
    label: 'Ce mois',
    resolve: (ref): RangeValue => ({
      kind: 'range',
      fromDate: toIso(new Date(ref.getFullYear(), ref.getMonth(), 1)),
      toDate: toIso(ref),
    }),
  },
  {
    key: 'last-month',
    label: 'Mois dernier',
    resolve: (ref): RangeValue => ({
      kind: 'range',
      fromDate: toIso(new Date(ref.getFullYear(), ref.getMonth() - 1, 1)),
      toDate: lastDayPrevMonthIso(ref),
    }),
  },
  {
    key: 'this-quarter',
    label: 'Ce trimestre',
    resolve: (ref): RangeValue => ({
      kind: 'range',
      fromDate: toIso(new Date(ref.getFullYear(), Math.floor(ref.getMonth() / 3) * 3, 1)),
      toDate: toIso(ref),
    }),
  },
  {
    key: 'this-year',
    label: 'Cet exercice',
    describe: (ref) => `01 janv. → ${formatHuman(toIso(ref))}`,
    resolve: (ref): RangeValue => ({
      kind: 'range',
      fromDate: yearStartIso(ref),
      toDate: toIso(ref),
    }),
  },
  {
    key: 'prev-year',
    label: 'Exercice N-1',
    describe: (ref) => `${ref.getFullYear() - 1}`,
    resolve: (ref): RangeValue => ({
      kind: 'range',
      fromDate: previousYearStartIso(ref),
      toDate: previousYearEndIso(ref),
    }),
  },
];

/** Presets d'arrêté (date instantanée + exercice de rattachement). */
export const AS_AT_PRESETS: ReadonlyArray<PeriodPreset> = [
  {
    key: 'today',
    label: "Aujourd'hui",
    resolve: (ref): AsAtValue => ({
      kind: 'as-at',
      asAtDate: toIso(ref),
      fiscalYearStartDate: yearStartIso(ref),
    }),
  },
  {
    key: 'month-end',
    label: 'Fin du mois dernier',
    resolve: (ref): AsAtValue => ({
      kind: 'as-at',
      asAtDate: lastDayPrevMonthIso(ref),
      fiscalYearStartDate: yearStartIso(ref),
    }),
  },
  {
    key: 'year-end',
    label: 'Clôture N-1',
    describe: (ref) => `31 déc. ${ref.getFullYear() - 1}`,
    resolve: (ref): AsAtValue => ({
      kind: 'as-at',
      asAtDate: previousYearEndIso(ref),
      fiscalYearStartDate: previousYearStartIso(ref),
    }),
  },
];

export const presetsFor = (kind: PeriodKind): ReadonlyArray<PeriodPreset> =>
  kind === 'range' ? RANGE_PRESETS : AS_AT_PRESETS;

/** Renvoie la clé du preset qui correspond exactement à `value`, sinon null. */
export const matchPreset = (value: PeriodValue, ref: Date = new Date()): string | null => {
  for (const preset of presetsFor(value.kind)) {
    const r = preset.resolve(ref);
    if (r.kind === 'range' && value.kind === 'range') {
      if (r.fromDate === value.fromDate && r.toDate === value.toDate) return preset.key;
    } else if (r.kind === 'as-at' && value.kind === 'as-at') {
      if (r.asAtDate === value.asAtDate && r.fiscalYearStartDate === value.fiscalYearStartDate) {
        return preset.key;
      }
    }
  }
  return null;
};

/** Valeur par défaut pour un mode donné (exercice courant à ce jour). */
export const defaultPeriod = (kind: PeriodKind, ref: Date = new Date()): PeriodValue =>
  kind === 'range'
    ? { kind: 'range', fromDate: yearStartIso(ref), toDate: toIso(ref) }
    : { kind: 'as-at', asAtDate: toIso(ref), fiscalYearStartDate: yearStartIso(ref) };
