/**
 * Arithmétique monétaire signée du module Budget.
 *
 * Les montants budgétaires peuvent être négatifs (décaissements de
 * trésorerie, corrections), contrairement aux montants comptables purs —
 * d'où un helper dédié plutôt que `journals/lib/decimal.ts` (qui rejette
 * le signe). Tout passe par des `bigint` en centimes pour éviter IEEE-754.
 */

const CENTS = 100n; // échelle des montants (2 décimales)
const RATE_SCALE = 1_000_000n; // échelle du taux de change (6 décimales)

/** Parse un montant signé "−123.45" → centimes bigint. */
export function amountToCents(value: string): bigint {
  const str = value.trim();
  if (!/^-?\d{1,16}(\.\d{1,2})?$/.test(str)) {
    throw new Error(`Invalid budget amount: ${JSON.stringify(value)}`);
  }
  const negative = str.startsWith('-');
  const unsigned = negative ? str.slice(1) : str;
  const [intPart, fracPart = ''] = unsigned.split('.');
  const cents = BigInt(intPart) * CENTS + BigInt(fracPart.padEnd(2, '0'));
  return negative ? -cents : cents;
}

/** Centimes bigint → string "N.NN" signée. */
export function centsToAmount(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  const whole = (abs / CENTS).toString();
  const frac = (abs % CENTS).toString().padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

/** Parse un taux "1.234567" → micro-unités bigint (6 décimales). */
function rateToMicros(rate: string): bigint {
  const str = rate.trim();
  if (!/^\d{1,6}(\.\d{1,6})?$/.test(str)) {
    throw new Error(`Invalid exchange rate: ${JSON.stringify(rate)}`);
  }
  const [intPart, fracPart = ''] = str.split('.');
  return BigInt(intPart) * RATE_SCALE + BigInt(fracPart.padEnd(6, '0'));
}

/** Division bigint avec arrondi half-up (sur valeur absolue). */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n;
  const abs = numerator < 0n ? -numerator : numerator;
  const q = abs / denominator;
  const r = abs % denominator;
  const rounded = r * 2n >= denominator ? q + 1n : q;
  return sign * rounded;
}

/**
 * Convertit un montant en devise de base : `amount` (2 dp) × `rate` (6 dp),
 * arrondi half-up à 2 décimales. Retourne une string "N.NN".
 */
export function toBaseAmount(amount: string, rate: string): string {
  const cents = amountToCents(amount);
  const micros = rateToMicros(rate);
  // cents × micros est à l'échelle 100 × 1e6 ; on ramène à l'échelle 100.
  const baseCents = divRoundHalfUp(cents * micros, RATE_SCALE);
  return centsToAmount(baseCents);
}

/** Somme signée de montants string. */
export function sumAmounts(values: ReadonlyArray<string>): string {
  let total = 0n;
  for (const v of values) total += amountToCents(v);
  return centsToAmount(total);
}

/** Écart = a − b (signé). */
export function subtractAmounts(a: string, b: string): string {
  return centsToAmount(amountToCents(a) - amountToCents(b));
}

/**
 * Pourcentage `part / whole × 100`, arrondi à l'entier le plus proche.
 * Retourne `null` si `whole` vaut 0 (division impossible / non significative).
 */
export function percentOf(part: string, whole: string): number | null {
  const wholeCents = amountToCents(whole);
  if (wholeCents === 0n) return null;
  const partCents = amountToCents(part);
  // ×100 pour le %, ×10 pour une décimale de rounding, puis Number final.
  const scaled = divRoundHalfUp(partCents * 1000n, wholeCents);
  return Number(scaled) / 10;
}
