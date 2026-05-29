import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { type LeaseFrequency, periodsPerYear } from '../types/lease.types';

/**
 * W4.5 — Calcul du taux d'intérêt implicite et du tableau
 * d'amortissement d'un contrat de crédit-bail / location-acquisition.
 *
 * Fonctions PURES — pas d'I/O, pas d'état caché. Testables en
 * isolation totale.
 *
 * Référence : SYSCOHADA Tome 2 chap. 8, annexes 37-38.
 *
 *   PV(rate) = installment × ((1 - (1 + rate)^-n) / rate) + option / (1 + rate)^n
 *
 * Le taux périodique recherché est celui qui annule
 * `PV(rate) - fairValue`. La fonction est monotone décroissante en
 * `rate`, ce qui permet une bisection robuste sur [0, 1].
 */

const BISECTION_TOLERANCE = 0.01; // tolérance sur PV - fairValue (en monnaie)
const BISECTION_MAX_ITER = 200;
const BISECTION_LOWER = 0;
const BISECTION_UPPER = 1; // 100 % par période — borne très haute

export interface AmortizationRow {
  readonly dueDate: string;
  readonly installmentNumber: number;
  readonly totalAmount: number;
  readonly interestPart: number;
  readonly capitalPart: number;
  readonly outstandingBalance: number;
}

/**
 * Valeur actualisée d'une suite de loyers constants `installmentAmount`
 * sur `periods` périodes, augmentée d'une option d'achat finale
 * `optionAmount` actualisée à la dernière période.
 *
 * Cas particulier `periodicRate === 0` : la somme dégénère en
 * `installment × periods + option` (aucun escompte).
 */
export function presentValue(
  installmentAmount: number,
  periodicRate: number,
  periods: number,
  optionAmount: number,
): number {
  if (periodicRate === 0) {
    return installmentAmount * periods + optionAmount;
  }
  const annuityFactor = (1 - Math.pow(1 + periodicRate, -periods)) / periodicRate;
  const optionPv = optionAmount / Math.pow(1 + periodicRate, periods);
  return installmentAmount * annuityFactor + optionPv;
}

/**
 * Recherche du taux périodique implicite par bisection.
 *
 * Stratégie :
 *   - f(rate) = PV(rate) - fairValue
 *   - f(0)  > 0  (somme nominale > juste valeur — sinon contrat sans
 *                 intérêts, on retourne 0)
 *   - f(1)  < 0  (à 100 % par période, PV s'effondre largement)
 *   - bisection classique sur f, convergence sur |PV - fairValue|.
 *
 * Retourne le taux ANNUEL (= taux périodique × périodes/an).
 *
 * @throws AppException `LEASE_IMPLICIT_RATE_CALCULATION_FAILED` si la
 *   bisection ne converge pas ou si les bornes ne contiennent pas le
 *   zéro (cas pathologique : nominal < juste valeur, contrat
 *   économiquement incohérent).
 */
export function findImplicitRate(
  fairValue: number,
  installmentAmount: number,
  periods: number,
  optionAmount: number,
  frequency: LeaseFrequency,
): number {
  if (fairValue <= 0 || installmentAmount <= 0 || periods <= 0) {
    throw new AppException(ERROR_CODES.LEASE_IMPLICIT_RATE_CALCULATION_FAILED, {
      message: `Invalid lease parameters: fairValue=${fairValue} installment=${installmentAmount} periods=${periods}`,
    });
  }

  const nominalTotal = installmentAmount * periods + optionAmount;
  // Si le nominal est inférieur à la juste valeur, aucun taux >= 0
  // ne peut équilibrer l'équation — contrat économiquement absurde.
  if (nominalTotal < fairValue - BISECTION_TOLERANCE) {
    throw new AppException(ERROR_CODES.LEASE_IMPLICIT_RATE_CALCULATION_FAILED, {
      message: `Nominal total (${nominalTotal}) < fair value (${fairValue}): no implicit rate >= 0.`,
    });
  }
  // Cas dégénéré : nominal == fair value → taux périodique = 0.
  if (Math.abs(nominalTotal - fairValue) <= BISECTION_TOLERANCE) {
    return 0;
  }

  let low = BISECTION_LOWER;
  let high = BISECTION_UPPER;
  let fLow = presentValue(installmentAmount, low, periods, optionAmount) - fairValue;
  let fHigh = presentValue(installmentAmount, high, periods, optionAmount) - fairValue;

  // Vérifie que les bornes encadrent bien le zéro.
  if (fLow * fHigh > 0) {
    throw new AppException(ERROR_CODES.LEASE_IMPLICIT_RATE_CALCULATION_FAILED, {
      message: `Bisection bounds do not bracket the root: f(0)=${fLow} f(1)=${fHigh}.`,
    });
  }

  for (let iter = 0; iter < BISECTION_MAX_ITER; iter++) {
    const mid = (low + high) / 2;
    const fMid = presentValue(installmentAmount, mid, periods, optionAmount) - fairValue;
    if (Math.abs(fMid) <= BISECTION_TOLERANCE) {
      return mid * periodsPerYear(frequency);
    }
    if (fLow * fMid < 0) {
      high = mid;
      fHigh = fMid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }

  throw new AppException(ERROR_CODES.LEASE_IMPLICIT_RATE_CALCULATION_FAILED, {
    message: `Bisection did not converge within ${BISECTION_MAX_ITER} iterations.`,
  });
}

/**
 * Construit le tableau d'amortissement à partir du taux périodique
 * trouvé. À chaque période :
 *
 *   interest = outstanding × periodicRate
 *   capital  = installment - interest
 *   outstanding -= capital
 *
 * La dernière période absorbe l'option d'achat : `totalAmount` =
 * `installment + option`, et `capitalPart` est ajusté pour solder
 * exactement la dette (corrige les arrondis cumulés).
 */
export function buildAmortizationSchedule(
  fairValue: number,
  periodicRate: number,
  installmentAmount: number,
  periods: number,
  optionAmount: number,
  frequency: LeaseFrequency,
  startDate: string,
): ReadonlyArray<AmortizationRow> {
  const rows: AmortizationRow[] = [];
  let outstanding = fairValue;

  for (let i = 1; i <= periods; i++) {
    const isLast = i === periods;
    const interest = round2(outstanding * periodicRate);
    const periodTotal = isLast ? installmentAmount + optionAmount : installmentAmount;
    // Sur la dernière échéance, on solde la dette : capital = outstanding.
    const capital = isLast ? round2(outstanding) : round2(periodTotal - interest);
    const adjustedTotal = isLast ? round2(capital + interest) : round2(periodTotal);
    outstanding = round2(outstanding - capital);

    rows.push({
      dueDate: addPeriods(startDate, i, frequency),
      installmentNumber: i,
      totalAmount: adjustedTotal,
      interestPart: interest,
      capitalPart: capital,
      outstandingBalance: Math.max(0, outstanding),
    });
  }

  return rows;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Décale une date ISO YYYY-MM-DD de `n` périodes selon la fréquence.
 * Implémentation volontairement simple — pas de dépendance à un
 * package date (cohérent avec le reste du back).
 */
function addPeriods(startDate: string, n: number, frequency: LeaseFrequency): string {
  const [yearStr, monthStr, dayStr] = startDate.split('-');
  const baseYear = Number(yearStr);
  const baseMonth = Number(monthStr); // 1-12
  const baseDay = Number(dayStr);

  let monthsToAdd: number;
  switch (frequency) {
    case 'monthly':
      monthsToAdd = n;
      break;
    case 'quarterly':
      monthsToAdd = n * 3;
      break;
    case 'annual':
      monthsToAdd = n * 12;
      break;
  }

  // Calcul mois total en base 0 puis retour 1-12.
  const totalMonthsZeroBased = baseMonth - 1 + monthsToAdd;
  const newYear = baseYear + Math.floor(totalMonthsZeroBased / 12);
  const newMonth = (totalMonthsZeroBased % 12) + 1;
  // Gère les fins de mois (31 janvier + 1 mois → 28/29 fév.).
  const lastDayOfNewMonth = new Date(newYear, newMonth, 0).getDate();
  const newDay = Math.min(baseDay, lastDayOfNewMonth);

  const mm = String(newMonth).padStart(2, '0');
  const dd = String(newDay).padStart(2, '0');
  return `${newYear}-${mm}-${dd}`;
}
