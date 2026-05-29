'use client';

/**
 * Report Console — favoris & historique persistés (localStorage via zustand).
 *
 * Pourquoi persister : un expert-comptable rejoue chaque matin la même
 * combinaison (« Bilan arrêté 31/12 + N-1 »). La mémoire volatile du
 * `period-store` actuel se perd au rechargement ; ces stores survivent.
 *
 * Clé de scope = `${orgId}:${mode}` afin qu'un favori « Bilan » d'un dossier
 * client ne pollue ni un autre dossier, ni un autre état.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { PeriodValue, ReportFavorite, ReportRun } from './types';

const scopeKey = (orgId: string, mode: string): string => `${orgId}:${mode}`;

/** Génère un id stable sans dépendre de crypto (SSR-safe, suffisant ici). */
const makeId = (): string => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

const HISTORY_LIMIT = 8;

// ─── Favoris ──────────────────────────────────────────────────────────

interface FavoritesState {
  readonly byScope: Readonly<Record<string, ReadonlyArray<ReportFavorite>>>;
  add: (
    orgId: string,
    mode: string,
    label: string,
    period: PeriodValue,
    scope?: Record<string, string | boolean>,
  ) => void;
  remove: (orgId: string, mode: string, id: string) => void;
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set) => ({
      byScope: {},
      add: (orgId, mode, label, period, scope) =>
        set((state) => {
          const key = scopeKey(orgId, mode);
          const next: ReportFavorite = {
            id: makeId(),
            label: label.trim() || 'Sans nom',
            period,
            scope,
            createdAt: new Date().toISOString(),
          };
          const existing = state.byScope[key] ?? [];
          return { byScope: { ...state.byScope, [key]: [next, ...existing] } };
        }),
      remove: (orgId, mode, id) =>
        set((state) => {
          const key = scopeKey(orgId, mode);
          const existing = state.byScope[key] ?? [];
          return {
            byScope: { ...state.byScope, [key]: existing.filter((f) => f.id !== id) },
          };
        }),
    }),
    { name: 'erp-reports-favorites/v1' },
  ),
);

/** Hook sélecteur : favoris du scope courant (tableau stable par référence). */
export const useFavorites = (orgId: string, mode: string): ReadonlyArray<ReportFavorite> =>
  useFavoritesStore((s) => s.byScope[scopeKey(orgId, mode)] ?? EMPTY_FAVORITES);

const EMPTY_FAVORITES: ReadonlyArray<ReportFavorite> = [];

// ─── Historique ─────────────────────────────────────────────────────────

interface HistoryState {
  readonly byScope: Readonly<Record<string, ReadonlyArray<ReportRun>>>;
  record: (
    orgId: string,
    mode: string,
    period: PeriodValue,
    durationMs: number,
    scope?: Record<string, string | boolean>,
  ) => void;
  clear: (orgId: string, mode: string) => void;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      byScope: {},
      record: (orgId, mode, period, durationMs, scope) =>
        set((state) => {
          const key = scopeKey(orgId, mode);
          const entry: ReportRun = {
            id: makeId(),
            period,
            scope,
            generatedAt: new Date().toISOString(),
            durationMs,
          };
          const existing = state.byScope[key] ?? [];
          return {
            byScope: {
              ...state.byScope,
              [key]: [entry, ...existing].slice(0, HISTORY_LIMIT),
            },
          };
        }),
      clear: (orgId, mode) =>
        set((state) => {
          const key = scopeKey(orgId, mode);
          const copy = { ...state.byScope };
          delete copy[key];
          return { byScope: copy };
        }),
    }),
    { name: 'erp-reports-history/v1' },
  ),
);

const EMPTY_HISTORY: ReadonlyArray<ReportRun> = [];

export const useHistory = (orgId: string, mode: string): ReadonlyArray<ReportRun> =>
  useHistoryStore((s) => s.byScope[scopeKey(orgId, mode)] ?? EMPTY_HISTORY);
