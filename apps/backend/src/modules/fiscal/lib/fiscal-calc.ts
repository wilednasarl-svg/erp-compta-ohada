import type { FiscalPeriodicity } from '../types/fiscal.types';

/**
 * Calculs fiscaux purs (sans I/O, sans `Date.now`) : date d'échéance et
 * montant dû. Tout passe par des `bigint` pour éviter IEEE-754.
 */

const CENTS = 100n;
const RATE_SCALE = 10_000n; // taux NUMERIC(8,4) → 4 décimales

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const table = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return table[month - 1];
}

/** Mois de référence pour l'échéance annuelle (avril N+1 par défaut). */
const ANNUAL_DUE_MONTH = 4;

/**
 * Date limite de dépôt (ISO `AAAA-MM-JJ`).
 *
 * - mensuel / trimestriel : le `dueDay` du mois SUIVANT la période (pour le
 *   trimestriel, `periodMonth` = mois de fin de trimestre : 3/6/9/12).
 * - annuel : le `dueDay` d'avril de l'exercice suivant (échéance solde IS /
 *   patente — paramétrable ultérieurement par impôt).
 *
 * Le jour est borné au dernier jour du mois cible (ex. dueDay 31 en février).
 */
export function computeDueDate(
  periodYear: number,
  periodMonth: number | null,
  periodicity: FiscalPeriodicity,
  dueDay: number,
): string {
  let targetYear: number;
  let targetMonth: number;

  if (periodicity === 'annual') {
    targetYear = periodYear + 1;
    targetMonth = ANNUAL_DUE_MONTH;
  } else {
    const baseMonth = periodMonth ?? 12;
    if (baseMonth >= 12) {
      targetYear = periodYear + 1;
      targetMonth = 1;
    } else {
      targetYear = periodYear;
      targetMonth = baseMonth + 1;
    }
  }

  const day = Math.min(dueDay, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${pad2(targetMonth)}-${pad2(day)}`;
}

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

function rateToScaled(rate: string): bigint {
  const str = rate.trim();
  if (!/^\d{1,4}(\.\d{1,4})?$/.test(str)) {
    throw new Error(`Invalid rate: ${JSON.stringify(rate)}`);
  }
  const [intPart, fracPart = ''] = str.split('.');
  return BigInt(intPart) * RATE_SCALE + BigInt(fracPart.padEnd(4, '0'));
}

function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n;
  const abs = numerator < 0n ? -numerator : numerator;
  const q = abs / denominator;
  const r = abs % denominator;
  return sign * (r * 2n >= denominator ? q + 1n : q);
}

/**
 * Montant dû = base (éventuellement plafonnée) × taux %, arrondi half-up à
 * 2 décimales. `rate` est un pourcentage (ex. "18.0000" = 18%).
 */
export function computeAmountDue(base: string, rate: string, ceiling?: string | null): string {
  let baseCents = amountToCents(base);
  if (ceiling != null && ceiling !== '') {
    const ceilCents = amountToCents(ceiling);
    if (baseCents > ceilCents) baseCents = ceilCents;
  }
  const rateScaled = rateToScaled(rate);
  // baseCents × rateScaled est à l'échelle CENTS × RATE_SCALE × 100 (le %).
  const amountCents = divRoundHalfUp(baseCents * rateScaled, RATE_SCALE * 100n);
  return centsToAmount(amountCents);
}
