import { computeAmountDue, sumAmounts } from './fiscal-calc';
import { computeProgressiveTax, type TaxBracket } from './progressive-tax';

/**
 * Calcul des charges sociales PAR TÊTE puis agrégation — pur, sans I/O.
 *
 * Pourquoi par tête : le plafond CNPS et le barème ITS s'appliquent à chaque
 * salarié individuellement. Plafonner/barémer la masse salariale agrégée
 * donne un résultat FAUX (le plafond écrête trop peu, le progressif n'est pas
 * additif).
 */

/**
 * Σ des bruts plafonnés par tête : Σ min(brut_i, plafond). `ceiling` nul =
 * pas de plafond (Σ brut). On choisit la plus petite valeur par comparaison
 * numérique mais on conserve la string d'origine (zéro perte de précision).
 */
export function cappedSum(grosses: ReadonlyArray<string>, ceiling: string | null): string {
  const capped = grosses.map((g) =>
    ceiling == null ? g : Number(g) <= Number(ceiling) ? g : ceiling,
  );
  return sumAmounts(capped);
}

/**
 * Contribution à taux plat plafonnée, exacte par tête. Comme le taux est
 * linéaire, Σ(min(brut_i, plafond)) × taux = Σ(min(brut_i, plafond) × taux).
 */
export function flatContribution(
  grosses: ReadonlyArray<string>,
  rate: string,
  ceiling: string | null,
): string {
  return computeAmountDue(cappedSum(grosses, ceiling), rate, null);
}

/**
 * Contribution à barème progressif (ITS) : Σ par tête du progressif appliqué
 * à chaque brut individuel (non additif, d'où le calcul par salarié).
 */
export function progressiveContribution(
  grosses: ReadonlyArray<string>,
  brackets: ReadonlyArray<TaxBracket>,
): string {
  return sumAmounts(grosses.map((g) => computeProgressiveTax(g, brackets)));
}
