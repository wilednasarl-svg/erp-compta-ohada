/**
 * Calcul d'impôt à barème PROGRESSIF (ITS). Pur, sans I/O. Tout en `bigint`.
 *
 * Impôt = Σ sur les tranches de (min(base, to) − from) × rate, pour les
 * tranches où base > from. `toAmount` nul = tranche supérieure ouverte.
 */

const CENTS = 100n;
const RATE_SCALE = 10_000n; // NUMERIC(8,4)

export interface TaxBracket {
  readonly fromAmount: string;
  readonly toAmount: string | null;
  readonly rate: string;
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
  const q = numerator / denominator;
  const r = numerator % denominator;
  return r * 2n >= denominator ? q + 1n : q;
}

/**
 * Calcule l'impôt progressif sur `base`. Les tranches sont triées par borne
 * inférieure croissante. Base négative → 0.
 */
export function computeProgressiveTax(base: string, brackets: ReadonlyArray<TaxBracket>): string {
  const baseCents = amountToCents(base);
  if (baseCents <= 0n) return '0.00';

  const sorted = [...brackets].sort((a, b) =>
    Number(amountToCents(a.fromAmount) - amountToCents(b.fromAmount)),
  );

  let taxScaled = 0n; // échelle CENTS × RATE_SCALE
  for (const bracket of sorted) {
    const from = amountToCents(bracket.fromAmount);
    if (baseCents <= from) break;
    const to = bracket.toAmount == null ? baseCents : amountToCents(bracket.toAmount);
    const upper = baseCents < to ? baseCents : to;
    const taxable = upper - from;
    if (taxable <= 0n) continue;
    taxScaled += taxable * rateToScaled(bracket.rate);
  }

  // taxScaled est à l'échelle CENTS × RATE_SCALE × 100 (le %). Ramener à CENTS.
  const taxCents = divRoundHalfUp(taxScaled, RATE_SCALE * 100n);
  return centsToAmount(taxCents);
}
