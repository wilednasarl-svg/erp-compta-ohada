/**
 * Dérive un indice de validité honnête à partir d'un rapport réellement généré.
 *
 * Tant qu'aucun endpoint de validité pré-génération n'existe côté backend
 * (cf. issue de suivi), on ne fabrique aucune donnée : on ne renseigne que ce
 * que le rapport contient réellement. Pour le Bilan, c'est l'équilibre
 * Actif = Passif via `totals.difference`.
 */

import type {
  BalanceSheetReport,
  CashFlowReport,
  ProfitLossReport,
  SigReport,
  TrialBalanceReport,
} from '@/types/reports';

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

/**
 * Compte de résultat : aucun invariant débit=crédit (le CR produit un résultat,
 * il n'est pas censé « équilibrer »). On n'expose donc pas d'`imbalance` — seuls
 * la date de fin et la fraîcheur sont renseignées. Le résultat (bénéfice/perte)
 * est porté par le rendu lui-même.
 */
export const validityFromProfitLoss = (report: ProfitLossReport): PeriodValidity => ({
  lastMovementDate: report.toDate,
  computedAt: new Date().toISOString(),
  periodClosed: false,
});

/**
 * SIG : cascade de soldes intermédiaires, sans invariant débit=crédit
 * (comme le CR). Seules date de fin et fraîcheur sont renseignées.
 */
export const validityFromSig = (report: SigReport): PeriodValidity => ({
  lastMovementDate: report.toDate,
  computedAt: new Date().toISOString(),
  periodClosed: false,
});

/**
 * TFT : `coherenceCheck` = |ZH − trésorerie comptes classe 5|. > 1 FCFA révèle
 * un défaut de mapping → exposé comme `imbalance` (signal réel de fiabilité).
 */
export const validityFromCashFlow = (report: CashFlowReport): PeriodValidity => {
  const incoherence = Math.abs(Number(report.coherenceCheck));
  return {
    imbalance: incoherence < BALANCE_EPSILON ? 0 : Math.round(incoherence),
    lastMovementDate: report.toDate,
    computedAt: new Date().toISOString(),
    periodClosed: false,
  };
};

/** Équilibre d'une balance : Σ débit clôture vs Σ crédit clôture. */
export const validityFromTrialBalance = (report: TrialBalanceReport): PeriodValidity => {
  const difference = Math.abs(
    Number(report.totals.endingDebit) - Number(report.totals.endingCredit),
  );
  return {
    imbalance: difference < BALANCE_EPSILON ? 0 : Math.round(difference),
    lastMovementDate: report.toDate,
    computedAt: new Date().toISOString(),
    periodClosed: false,
  };
};
