import { beforeEach, describe, expect, it } from 'vitest';

import { useFavoritesStore, useHistoryStore } from './stores';
import type { PeriodValue } from './types';

const PERIOD: PeriodValue = { kind: 'range', fromDate: '2026-01-01', toDate: '2026-05-29' };
const ORG_A = 'org-a';
const ORG_B = 'org-b';

beforeEach(() => {
  useFavoritesStore.setState({ byScope: {} });
  useHistoryStore.setState({ byScope: {} });
  localStorage.clear();
});

describe('useFavoritesStore', () => {
  const favs = (orgId: string, mode: string) =>
    useFavoritesStore.getState().byScope[`${orgId}:${mode}`] ?? [];

  it('ajoute un favori et le place en tête', () => {
    const { add } = useFavoritesStore.getState();
    add(ORG_A, 'balance-sheet', 'Bilan quotidien', PERIOD, { compare: true });
    add(ORG_A, 'balance-sheet', 'Bilan trimestriel', PERIOD);

    const list = favs(ORG_A, 'balance-sheet');
    expect(list).toHaveLength(2);
    expect(list[0]!.label).toBe('Bilan trimestriel');
    expect(list[1]!.label).toBe('Bilan quotidien');
    expect(list[1]!.scope).toEqual({ compare: true });
    expect(list[1]!.period).toEqual(PERIOD);
  });

  it('remplace un libellé vide par « Sans nom »', () => {
    useFavoritesStore.getState().add(ORG_A, 'balance-sheet', '   ', PERIOD);
    expect(favs(ORG_A, 'balance-sheet')[0]!.label).toBe('Sans nom');
  });

  it('supprime un favori par id sans toucher aux autres', () => {
    const { add, remove } = useFavoritesStore.getState();
    add(ORG_A, 'balance-sheet', 'A', PERIOD);
    add(ORG_A, 'balance-sheet', 'B', PERIOD);
    const toRemove = favs(ORG_A, 'balance-sheet').find((f) => f.label === 'A')!;

    remove(ORG_A, 'balance-sheet', toRemove.id);

    const list = favs(ORG_A, 'balance-sheet');
    expect(list).toHaveLength(1);
    expect(list[0]!.label).toBe('B');
  });

  it('cloisonne par dossier (orgId) et par état (mode)', () => {
    const { add } = useFavoritesStore.getState();
    add(ORG_A, 'balance-sheet', 'A-bilan', PERIOD);
    add(ORG_B, 'balance-sheet', 'B-bilan', PERIOD);
    add(ORG_A, 'profit-loss', 'A-cr', PERIOD);

    expect(favs(ORG_A, 'balance-sheet')).toHaveLength(1);
    expect(favs(ORG_B, 'balance-sheet')).toHaveLength(1);
    expect(favs(ORG_A, 'profit-loss')).toHaveLength(1);
    expect(favs(ORG_A, 'balance-sheet')[0]!.label).toBe('A-bilan');
    expect(favs(ORG_B, 'balance-sheet')[0]!.label).toBe('B-bilan');
  });
});

describe('useHistoryStore', () => {
  const runs = (orgId: string, mode: string) =>
    useHistoryStore.getState().byScope[`${orgId}:${mode}`] ?? [];

  it('enregistre une exécution en tête avec sa durée', () => {
    useHistoryStore.getState().record(ORG_A, 'balance-sheet', PERIOD, 1234, { compare: true });
    const list = runs(ORG_A, 'balance-sheet');
    expect(list).toHaveLength(1);
    expect(list[0]!.durationMs).toBe(1234);
    expect(list[0]!.scope).toEqual({ compare: true });
    expect(typeof list[0]!.generatedAt).toBe('string');
  });

  it('plafonne l’historique à 8 et conserve les plus récents', () => {
    const { record } = useHistoryStore.getState();
    for (let i = 1; i <= 10; i += 1) {
      record(ORG_A, 'balance-sheet', PERIOD, i);
    }
    const list = runs(ORG_A, 'balance-sheet');
    expect(list).toHaveLength(8);
    // Les deux plus anciens (durées 1 et 2) sont évincés ; le plus récent (10) est en tête.
    expect(list[0]!.durationMs).toBe(10);
    expect(list[7]!.durationMs).toBe(3);
    expect(list.some((r) => r.durationMs === 1 || r.durationMs === 2)).toBe(false);
  });

  it('clear vide uniquement le scope ciblé', () => {
    const { record, clear } = useHistoryStore.getState();
    record(ORG_A, 'balance-sheet', PERIOD, 100);
    record(ORG_B, 'balance-sheet', PERIOD, 200);

    clear(ORG_A, 'balance-sheet');

    expect(runs(ORG_A, 'balance-sheet')).toHaveLength(0);
    expect(runs(ORG_B, 'balance-sheet')).toHaveLength(1);
  });

  it('cloisonne par dossier et par état', () => {
    const { record } = useHistoryStore.getState();
    record(ORG_A, 'balance-sheet', PERIOD, 1);
    record(ORG_A, 'profit-loss', PERIOD, 2);
    expect(runs(ORG_A, 'balance-sheet')).toHaveLength(1);
    expect(runs(ORG_A, 'profit-loss')).toHaveLength(1);
  });
});
