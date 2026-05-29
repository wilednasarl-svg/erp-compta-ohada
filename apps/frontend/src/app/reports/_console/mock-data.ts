/**
 * Données simulées pour le prototype `/reports/console` — aucune dépendance
 * backend, afin que le parcours soit consultable et démontrable hors ligne.
 * Trois scénarios de validité pour démontrer les états de l'interface.
 */

import type { PeriodValidity } from './types';

export type ValidityScenario = 'sain' | 'desequilibre' | 'vide';

export const VALIDITY_SCENARIOS: Record<ValidityScenario, PeriodValidity> = {
  sain: {
    committedEntries: 4287,
    imbalance: 0,
    lastMovementDate: '2025-12-29',
    computedAt: new Date(Date.now() - 4 * 60000).toISOString(),
    periodClosed: false,
  },
  desequilibre: {
    committedEntries: 4290,
    imbalance: 152_400,
    lastMovementDate: '2025-12-31',
    computedAt: new Date(Date.now() - 60000).toISOString(),
    periodClosed: false,
  },
  vide: {
    committedEntries: 0,
    imbalance: 0,
    lastMovementDate: null,
    computedAt: new Date().toISOString(),
    periodClosed: false,
  },
};

export interface BilanRow {
  readonly poste: string;
  readonly label: string;
  readonly brut: number;
  readonly net: number;
  readonly netN1: number;
}

export interface BilanMasse {
  readonly title: string;
  readonly rows: ReadonlyArray<BilanRow>;
  readonly total: number;
  readonly totalN1: number;
}

/** Extrait de Bilan SYSCOHADA (actif) — assez riche pour montrer la densité. */
export const MOCK_BILAN_ACTIF: ReadonlyArray<BilanMasse> = [
  {
    title: 'Actif immobilisé',
    rows: [
      { poste: 'AD', label: 'Immobilisations incorporelles', brut: 18_400_000, net: 12_100_000, netN1: 9_800_000 },
      { poste: 'AI', label: 'Immobilisations corporelles', brut: 142_750_000, net: 98_320_000, netN1: 104_500_000 },
      { poste: 'AQ', label: 'Immobilisations financières', brut: 6_200_000, net: 6_200_000, netN1: 5_900_000 },
    ],
    total: 116_620_000,
    totalN1: 120_200_000,
  },
  {
    title: 'Actif circulant',
    rows: [
      { poste: 'BB', label: 'Stocks et en-cours', brut: 54_300_000, net: 51_900_000, netN1: 47_200_000 },
      { poste: 'BG', label: 'Créances clients', brut: 73_120_000, net: 69_400_000, netN1: 62_800_000 },
      { poste: 'BJ', label: 'Autres créances', brut: 11_050_000, net: 11_050_000, netN1: 9_300_000 },
    ],
    total: 132_350_000,
    totalN1: 119_300_000,
  },
  {
    title: 'Trésorerie-actif',
    rows: [
      { poste: 'BS', label: 'Banques, chèques postaux, caisse', brut: 38_900_000, net: 38_900_000, netN1: 28_400_000 },
    ],
    total: 38_900_000,
    totalN1: 28_400_000,
  },
];

export const MOCK_BILAN_TOTAL = { net: 287_870_000, netN1: 267_900_000 };
