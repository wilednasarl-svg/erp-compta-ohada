/**
 * Calcul du plan d'amortissement d'un investissement budgété (CAPEX) — pur,
 * sans I/O. Amortissement LINÉAIRE mensuel. Tout en `bigint` (centimes).
 *
 * On génère les dotations mensuelles d'un EXERCICE donné : pour chaque mois
 * compris dans la période d'amortissement [mise en service, +durée), une
 * dotation = montant / (durée_années × 12).
 */

const CENTS = 100n;

function amountToCents(value: string): bigint {
  const str = value.trim();
  if (!/^-?\d{1,16}(\.\d{1,2})?$/.test(str)) {
    throw new Error(`Invalid amount: ${JSON.stringify(value)}`);
  }
  const negative = str.startsWith('-');
  const unsigned = negative ? str.slice(1) : str;
  const [intPart, fracPart = ''] = unsigned.split('.');
  const cents = BigInt(intPart) * CENTS + BigInt(fracPart.padEnd(2, '0'));
  return negative ? -cents : cents;
}

function centsToAmount(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${(abs / CENTS).toString()}.${(abs % CENTS).toString().padStart(2, '0')}`;
}

function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n;
  const abs = numerator < 0n ? -numerator : numerator;
  const q = abs / denominator;
  const r = abs % denominator;
  return sign * (r * 2n >= denominator ? q + 1n : q);
}

export interface AmortizationInput {
  /** Montant de l'investissement (base d'amortissement). */
  readonly amount: string;
  /** Durée d'amortissement en années (> 0). */
  readonly durationYears: number;
  /** Année / mois de mise en service. */
  readonly serviceYear: number;
  readonly serviceMonth: number;
  /** Exercice pour lequel générer les dotations mensuelles. */
  readonly exerciseYear: number;
}

export interface AmortizationDotation {
  readonly periodMonth: number;
  readonly amount: string;
}

/**
 * Dotations mensuelles de l'exercice `exerciseYear`. Vide si l'exercice est
 * hors de la période d'amortissement.
 *
 * dotation_mensuelle = montant / (durée_années × 12)  (linéaire, arrondi 2 déc.)
 */
export function computeMonthlyDotations(input: AmortizationInput): AmortizationDotation[] {
  if (input.durationYears <= 0) {
    throw new Error('durationYears doit être > 0');
  }
  if (input.serviceMonth < 1 || input.serviceMonth > 12) {
    throw new Error('serviceMonth doit être 1..12');
  }

  const totalMonths = BigInt(input.durationYears) * 12n;
  const dotationCents = divRoundHalfUp(amountToCents(input.amount), totalMonths);

  // Index absolu (en mois) du début et de la fin de l'amortissement.
  const startIndex = input.serviceYear * 12 + (input.serviceMonth - 1);
  const endIndex = startIndex + input.durationYears * 12 - 1;

  const dotations: AmortizationDotation[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const absIndex = input.exerciseYear * 12 + (m - 1);
    if (absIndex >= startIndex && absIndex <= endIndex) {
      dotations.push({ periodMonth: m, amount: centsToAmount(dotationCents) });
    }
  }
  return dotations;
}

/** Dotation annuelle de l'exercice = somme des dotations mensuelles. */
export function annualDotation(input: AmortizationInput): string {
  const months = computeMonthlyDotations(input);
  let total = 0n;
  for (const d of months) total += amountToCents(d.amount);
  return centsToAmount(total);
}
