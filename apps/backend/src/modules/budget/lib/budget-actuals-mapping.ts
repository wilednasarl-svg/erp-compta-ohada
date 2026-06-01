/**
 * Logique pure de dérivation du « réalisé » (scénario REAL) à partir des
 * écritures comptables validées.
 *
 * Deux responsabilités, isolées ici pour être testables sans base de données :
 *  1. `orientActualAmount` — convertit un couple (débit, crédit) en un montant
 *     budgétaire signé, orienté selon le sens normal du compte SYSCOHADA, de
 *     sorte qu'il soit homogène avec la saisie du budget (une charge consommée
 *     et une charge budgétée sont toutes deux positives).
 *  2. `inferBudgetType` — mappe la classe SYSCOHADA d'un compte vers la grande
 *     famille de budget (OPEX/CAPEX/TRESO). Les classes hors pilotage
 *     budgétaire (bilan pur) retournent `null` → pas de ligne REAL générée.
 *
 * Montants en `string` NUMERIC, arithmétique en centimes `bigint`
 * (cf. `budget-money.ts`), jamais de flottant.
 */

import type { NormalBalance } from '../../accounting-plan/types/accounting-system';
import { amountToCents, centsToAmount } from './budget-money';
import type { BudgetType } from '../types/budget.types';

/**
 * Sens normal effectif d'un compte : `is_opposing` inverse le sens hérité de
 * la classe (ex. 49x dépréciation client = classe 4 mais comportement
 * créditeur). Voir `OrganizationAccountEntity.isOpposing`.
 */
export function effectiveNormalBalance(
  normalBalance: NormalBalance,
  isOpposing: boolean,
): NormalBalance {
  if (!isOpposing) return normalBalance;
  return normalBalance === 'D' ? 'C' : 'D';
}

/**
 * Montant réalisé orienté, en string signée.
 *
 * - Compte à solde normal débiteur (charges 6x, immobilisations 2x) :
 *   `débit − crédit` → positif quand le compte est mouvementé dans son sens.
 * - Compte à solde normal créditeur (produits 7x) :
 *   `crédit − débit` → positif quand un produit est constaté.
 *
 * Cette orientation rend le réalisé directement comparable au budget saisi,
 * sans retraitement de signe en aval.
 */
export function orientActualAmount(
  debit: string,
  credit: string,
  normalBalance: NormalBalance,
  isOpposing: boolean,
): string {
  const debitCents = amountToCents(debit);
  const creditCents = amountToCents(credit);
  const effective = effectiveNormalBalance(normalBalance, isOpposing);
  const oriented = effective === 'D' ? debitCents - creditCents : creditCents - debitCents;
  return centsToAmount(oriented);
}

/**
 * Mappe la classe SYSCOHADA vers la famille de budget.
 *
 * - Classe 2 (immobilisations)         → CAPEX
 * - Classe 5 (trésorerie)              → TRESO
 * - Classes 6 et 7 (charges, produits) → OPEX
 * - Autres classes (1, 3, 4, 8, 9)     → `null` (bilan / hors pilotage budget)
 *
 * Le rapprochement budget↔réalisé se faisant par compte, le `budgetType`
 * déduit ici doit correspondre à celui saisi côté budget initial pour le même
 * compte. Le découpage par classe est la convention par défaut ; un mapping
 * fin par compte pourra l'affiner ultérieurement.
 */
export function inferBudgetType(accountClass: number): BudgetType | null {
  switch (accountClass) {
    case 2:
      return 'CAPEX';
    case 5:
      return 'TRESO';
    case 6:
    case 7:
      return 'OPEX';
    default:
      return null;
  }
}

/** Classe SYSCOHADA déduite du premier caractère du code de compte. */
export function accountClassFromCode(code: string): number {
  const first = code.trim().charAt(0);
  const parsed = Number.parseInt(first, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}
