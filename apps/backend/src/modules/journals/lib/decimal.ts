/**
 * Helpers pour manipuler les montants comptables stockés en `DECIMAL(15,2)`.
 *
 * Toujours stocker / comparer en string ou bigint, JAMAIS en `number`
 * (IEEE-754 : 0.1 + 0.2 = 0.30000000000000004).
 *
 * Implémentation simple : on convertit chaque montant en `bigint` de
 * centimes pour les sommes / comparaisons, et on retourne une string
 * "N.NN" pour le stockage. Pour Module 8 wave 1 on n'a pas besoin
 * d'arithmétique plus avancée (multiplications de TVA, change devise) —
 * une lib externe (`decimal.js`) sera introduite en wave 2 si nécessaire.
 */

const SCALE = 2;
const SCALE_MULTIPLIER = 100n;

/**
 * Convertit une représentation décimale ("123.45", "0", number) en
 * centimes `bigint`. Rejette les entrées négatives — les montants
 * comptables n'admettent pas de signe (le côté débit/crédit le porte).
 */
export function toCents(value: string | number): bigint {
  const str = typeof value === 'number' ? value.toString() : value.trim();

  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    throw new Error(`Invalid decimal amount: ${JSON.stringify(value)}`);
  }

  const [intPart, fracPart = ''] = str.split('.');
  const paddedFrac = fracPart.padEnd(SCALE, '0');
  return BigInt(intPart) * SCALE_MULTIPLIER + BigInt(paddedFrac);
}

/**
 * Convertit un montant en centimes (`bigint`) en string "N.NN" pour
 * stockage ou retour API.
 */
export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  const wholeStr = (abs / SCALE_MULTIPLIER).toString();
  const fracStr = (abs % SCALE_MULTIPLIER).toString().padStart(SCALE, '0');
  return `${sign}${wholeStr}.${fracStr}`;
}

/**
 * Vérifie si deux montants (en string) sont strictement égaux à 2 décimales.
 */
export function decimalEquals(a: string | number, b: string | number): boolean {
  return toCents(a) === toCents(b);
}

/**
 * Somme une série de montants. Retourne le total en string "N.NN".
 */
export function decimalSum(values: ReadonlyArray<string | number>): string {
  let total = 0n;
  for (const v of values) total += toCents(v);
  return fromCents(total);
}

/**
 * `true` si le montant est strictement > 0.
 */
export function isPositive(value: string | number): boolean {
  return toCents(value) > 0n;
}

/**
 * `true` si le montant est exactement 0.
 */
export function isZero(value: string | number): boolean {
  return toCents(value) === 0n;
}
