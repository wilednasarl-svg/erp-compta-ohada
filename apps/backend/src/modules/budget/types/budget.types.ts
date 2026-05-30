/**
 * Types partagés du module Budget.
 *
 * Les unions de chaînes reflètent exactement les CHECK SQL de la migration
 * 0111 — toute évolution doit rester synchronisée des deux côtés.
 */

/** Type d'axe analytique (dimension de pilotage). */
export type BudgetAxisType = 'cost_center' | 'project' | 'agency' | 'product' | 'zone';

export const BUDGET_AXIS_TYPES: readonly BudgetAxisType[] = [
  'cost_center',
  'project',
  'agency',
  'product',
  'zone',
];

/** Grande famille de budget portée par la ligne. */
export type BudgetType = 'OPEX' | 'CAPEX' | 'TRESO' | 'RH';

export const BUDGET_TYPES: readonly BudgetType[] = ['OPEX', 'CAPEX', 'TRESO', 'RH'];

/**
 * Scénario : BI = budget initial, BR = budget révisé (forecast),
 * REAL = réalisé (alimenté depuis la comptabilité). Le calcul d'écart
 * compare REAL à BI (ou BR).
 */
export type BudgetScenario = 'BI' | 'BR' | 'REAL';

export const BUDGET_SCENARIOS: readonly BudgetScenario[] = ['BI', 'BR', 'REAL'];

/** Statut de validation d'une ligne (workflow de saisie). */
export type BudgetLineStatus = 'brouillon' | 'soumis' | 'valide_n1' | 'valide_daf' | 'verrouille';

export const BUDGET_LINE_STATUSES: readonly BudgetLineStatus[] = [
  'brouillon',
  'soumis',
  'valide_n1',
  'valide_daf',
  'verrouille',
];

/**
 * Transitions de statut autorisées (machine à états du workflow §3).
 * `brouillon → soumis → valide_n1 → valide_daf → verrouille`, avec retours
 * possibles en arrière tant que la ligne n'est pas verrouillée.
 */
export const BUDGET_STATUS_TRANSITIONS: Readonly<
  Record<BudgetLineStatus, readonly BudgetLineStatus[]>
> = {
  brouillon: ['soumis'],
  soumis: ['valide_n1', 'brouillon'],
  valide_n1: ['valide_daf', 'soumis'],
  valide_daf: ['verrouille', 'valide_n1'],
  verrouille: [],
};

/** Devise par défaut (franc CFA UEMOA). */
export const DEFAULT_BUDGET_CURRENCY = 'XOF';
