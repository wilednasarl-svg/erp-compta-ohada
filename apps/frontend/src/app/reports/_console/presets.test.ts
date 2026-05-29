import { describe, expect, it } from 'vitest';

import {
  AS_AT_PRESETS,
  RANGE_PRESETS,
  defaultPeriod,
  formatHuman,
  fromIso,
  matchPreset,
  presetsFor,
  shiftYears,
  summarizePeriod,
  toIso,
} from './presets';
import type { AsAtValue, RangeValue } from './types';

/** Référence figée : jeudi 29 mai 2026 (mois index 4, Q2). */
const REF = new Date(2026, 4, 29, 12, 0, 0, 0);

const resolveRange = (key: string): RangeValue =>
  RANGE_PRESETS.find((p) => p.key === key)!.resolve(REF) as RangeValue;
const resolveAsAt = (key: string): AsAtValue =>
  AS_AT_PRESETS.find((p) => p.key === key)!.resolve(REF) as AsAtValue;

describe('helpers de date', () => {
  it('toIso formate en YYYY-MM-DD avec zéro-padding (fuseau local)', () => {
    expect(toIso(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
    expect(toIso(REF)).toBe('2026-05-29');
  });

  it('fromIso ne dérive pas en UTC (le 31/12 reste le 31/12)', () => {
    const d = fromIso('2025-12-31');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });

  it('toIso ∘ fromIso est l’identité sur les bornes sensibles', () => {
    for (const iso of ['2025-12-31', '2026-01-01', '2026-02-28', '2026-05-29']) {
      expect(toIso(fromIso(iso))).toBe(iso);
    }
  });

  it('shiftYears décale l’année sans toucher mois/jour', () => {
    expect(shiftYears('2026-12-31', -1)).toBe('2025-12-31');
    expect(shiftYears('2026-01-01', -1)).toBe('2025-01-01');
    expect(shiftYears('2025-03-15', 2)).toBe('2027-03-15');
  });

  it('formatHuman rend un libellé FR compact', () => {
    expect(formatHuman('2025-12-31')).toBe('31 déc. 2025');
    expect(formatHuman('2026-01-01')).toBe('1 janv. 2026');
  });
});

describe('RANGE_PRESETS (bornes résolues sur la réf. injectée)', () => {
  it('« Ce mois » va du 1er du mois à la réf.', () => {
    expect(resolveRange('this-month')).toEqual({
      kind: 'range',
      fromDate: '2026-05-01',
      toDate: '2026-05-29',
    });
  });

  it('« Mois dernier » couvre le mois calendaire précédent complet', () => {
    expect(resolveRange('last-month')).toEqual({
      kind: 'range',
      fromDate: '2026-04-01',
      toDate: '2026-04-30',
    });
  });

  it('« Ce trimestre » démarre au 1er mois du trimestre courant (Q2 → avril)', () => {
    expect(resolveRange('this-quarter')).toEqual({
      kind: 'range',
      fromDate: '2026-04-01',
      toDate: '2026-05-29',
    });
  });

  it('« Cet exercice » va du 1er janvier à la réf.', () => {
    expect(resolveRange('this-year')).toEqual({
      kind: 'range',
      fromDate: '2026-01-01',
      toDate: '2026-05-29',
    });
  });

  it('« Exercice N-1 » couvre l’année civile précédente entière', () => {
    expect(resolveRange('prev-year')).toEqual({
      kind: 'range',
      fromDate: '2025-01-01',
      toDate: '2025-12-31',
    });
  });
});

describe('AS_AT_PRESETS', () => {
  it('« Aujourd’hui » = réf. + début d’exercice courant', () => {
    expect(resolveAsAt('today')).toEqual({
      kind: 'as-at',
      asAtDate: '2026-05-29',
      fiscalYearStartDate: '2026-01-01',
    });
  });

  it('« Fin du mois dernier » = dernier jour du mois précédent', () => {
    expect(resolveAsAt('month-end')).toEqual({
      kind: 'as-at',
      asAtDate: '2026-04-30',
      fiscalYearStartDate: '2026-01-01',
    });
  });

  it('« Clôture N-1 » = 31/12 N-1 rattaché à l’exercice N-1', () => {
    expect(resolveAsAt('year-end')).toEqual({
      kind: 'as-at',
      asAtDate: '2025-12-31',
      fiscalYearStartDate: '2025-01-01',
    });
  });
});

describe('matchPreset', () => {
  it('retrouve la clé d’un preset résolu avec la même réf.', () => {
    const value = resolveRange('this-year');
    expect(matchPreset(value, REF)).toBe('this-year');
  });

  it('retrouve un preset d’arrêté', () => {
    expect(matchPreset(resolveAsAt('year-end'), REF)).toBe('year-end');
  });

  it('renvoie null pour une période ne correspondant à aucun preset', () => {
    const value: RangeValue = { kind: 'range', fromDate: '2026-02-14', toDate: '2026-03-03' };
    expect(matchPreset(value, REF)).toBeNull();
  });

  it('ne mélange pas les sémantiques : une plage ne matche pas un preset d’arrêté', () => {
    const asRange: RangeValue = { kind: 'range', fromDate: '2025-01-01', toDate: '2025-12-31' };
    // 'prev-year' (range) matche, mais aucun preset as-at n'est testé pour une range.
    expect(matchPreset(asRange, REF)).toBe('prev-year');
    expect(presetsFor('range')).toBe(RANGE_PRESETS);
    expect(presetsFor('as-at')).toBe(AS_AT_PRESETS);
  });
});

describe('defaultPeriod', () => {
  it('range : exercice courant à ce jour', () => {
    expect(defaultPeriod('range', REF)).toEqual({
      kind: 'range',
      fromDate: '2026-01-01',
      toDate: '2026-05-29',
    });
  });

  it('as-at : arrêté du jour + début d’exercice', () => {
    expect(defaultPeriod('as-at', REF)).toEqual({
      kind: 'as-at',
      asAtDate: '2026-05-29',
      fiscalYearStartDate: '2026-01-01',
    });
  });
});

describe('summarizePeriod', () => {
  it('résume une plage avec une flèche', () => {
    expect(summarizePeriod({ kind: 'range', fromDate: '2026-01-01', toDate: '2026-05-29' })).toBe(
      '1 janv. 2026 → 29 mai 2026',
    );
  });

  it('résume un arrêté', () => {
    expect(
      summarizePeriod({ kind: 'as-at', asAtDate: '2025-12-31', fiscalYearStartDate: '2025-01-01' }),
    ).toBe('Arrêté au 31 déc. 2025');
  });
});
