/**
 * Dérive un indice de validité honnête à partir d'un rapport réellement généré.
 *
 * Tant qu'aucun endpoint de validité pré-génération n'existe côté backend
 * (cf. issue de suivi), on ne fabrique aucune donnée : on ne renseigne que ce
 * que le rapport contient réellement. Pour le Bilan, c'est l'équilibre
 * Actif = Passif via `totals.difference`.
 */

import type { BalanceSheetReport } from '@/types/reports';

import type { PeriodValidity } from './types';

/** Seuil d'arrondi : un écart < 1 FCFA est considéré équilibré (cents/arrondis). */
const BALANCE_EPSILON = 1;

export const validityFromBalanceSheet = (report: BalanceSheetReport): PeriodValidity => {
  const difference = Math.abs(Number(report.totals.difference));
  return {
    // committedEntries volontairement omis : non fourni par l'API actuelle.
    imbalance: difference < BALANCE_EPSILON ? 0 : Math.round(difference),
    lastMovementDate: report.asAtDate,
    computedAt: new Date().toISOString(),
    periodClosed: false,
  };
};
