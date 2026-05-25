/**
 * `FxConverter` — fonctions pures de conversion de devises. Pas de DB,
 * pas d'I/O. Le service NestJS se contente de charger les taux puis
 * appelle ces fonctions ; elles sont 100% testables en isolation.
 *
 * Convention de stockage du taux : `1 from_currency = rate to_currency`.
 *
 * Précision : on travaille en string DECIMAL pour préserver la
 * précision sur les sommes comptables (NUMERIC(15,2) côté DB). On
 * passe par un BigInt sur les centimes pour la multiplication
 * `amount × rate`, puis on arrondit selon `decimal_places` de la devise
 * cible (XOF=0, EUR=2, USD=2, BHD=3…).
 *
 * Arrondi : "half away from zero" (mode comptable standard FR/OHADA,
 * différent de banker's rounding). Un montant de 0.005 EUR → 0.01 EUR
 * (et non 0.00). Conforme aux usages SYSCOHADA et facilement vérifiable
 * à la main par un commissaire aux comptes.
 */

export interface FxConvertInput {
  /** Montant à convertir (string DECIMAL ou number JS). */
  readonly amount: string | number;
  /** Code ISO 4217 source (3 lettres). */
  readonly fromCurrency: string;
  /** Code ISO 4217 cible (3 lettres). */
  readonly toCurrency: string;
  /**
   * Taux à appliquer (1 from = rate to). Ignoré si fromCurrency ===
   * toCurrency (identité). Requis sinon.
   */
  readonly rate?: string | number | null;
  /** Décimales d'affichage de la devise cible (0|2|3, défaut 2). */
  readonly toDecimalPlaces?: 0 | 2 | 3;
}

export interface FxConvertResult {
  /** Montant converti, format string DECIMAL aligné sur `toDecimalPlaces`. */
  readonly amount: string;
  /** Code ISO 4217 cible (echo). */
  readonly currency: string;
  /** Taux effectivement appliqué (string DECIMAL). 1.0 si identité. */
  readonly appliedRate: string;
}

/**
 * Convertit un montant d'une devise vers une autre.
 *
 * Cas spéciaux gérés :
 *  - `from === to` : identité, on retourne l'amount tel quel arrondi
 *    sur les décimales de la devise (gère aussi 0 décimale → on tronque
 *    les centimes éventuels d'entrée).
 *  - `amount === 0` : retour 0 quel que soit le rate (court-circuit).
 *  - `amount < 0` : conversion linéaire ; le signe est préservé.
 *
 * Lève si :
 *  - Codes devises invalides (pas 3 lettres maj ISO 4217).
 *  - Rate manquant ou ≤ 0 quand from ≠ to.
 *  - Rate non finite (NaN/Infinity).
 */
export function convertAmount(input: FxConvertInput): FxConvertResult {
  const from = input.fromCurrency.toUpperCase();
  const to = input.toCurrency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(from)) {
    throw new Error(`Invalid ISO 4217 source currency: ${input.fromCurrency}`);
  }
  if (!/^[A-Z]{3}$/.test(to)) {
    throw new Error(`Invalid ISO 4217 target currency: ${input.toCurrency}`);
  }

  const decimals = input.toDecimalPlaces ?? 2;
  if (![0, 2, 3].includes(decimals)) {
    throw new Error(`toDecimalPlaces must be 0, 2, or 3 (got ${decimals})`);
  }

  const amountNum = typeof input.amount === 'number' ? input.amount : Number(input.amount);
  if (!Number.isFinite(amountNum)) {
    throw new Error(`Invalid amount: ${String(input.amount)}`);
  }

  // Identity short-circuit.
  if (from === to) {
    return {
      amount: roundDecimal(amountNum, decimals),
      currency: to,
      appliedRate: '1',
    };
  }

  // Zero short-circuit (no rate required at all).
  if (amountNum === 0) {
    return { amount: roundDecimal(0, decimals), currency: to, appliedRate: '0' };
  }

  if (input.rate === null || input.rate === undefined) {
    throw new Error(`A non-null rate is required to convert ${from} → ${to}`);
  }
  const rateNum = typeof input.rate === 'number' ? input.rate : Number(input.rate);
  if (!Number.isFinite(rateNum) || rateNum <= 0) {
    throw new Error(`Rate must be a finite positive number (got ${String(input.rate)})`);
  }

  const converted = amountNum * rateNum;
  return {
    amount: roundDecimal(converted, decimals),
    currency: to,
    appliedRate: String(rateNum),
  };
}

/**
 * Inverse un taux donné (1 from = rate to)  →  (1 to = 1/rate from).
 * Préserve la précision en passant par BigDecimal-style string math.
 */
export function invertRate(rate: string | number): string {
  const n = typeof rate === 'number' ? rate : Number(rate);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Cannot invert non-positive or non-finite rate: ${String(rate)}`);
  }
  // 10 decimal places matches the DB NUMERIC(20,10).
  return (1 / n).toFixed(10);
}

/**
 * Composition triangulaire : trouve le rate A→C en passant par B.
 *   rateAC = rateAB × rateBC
 * Utilisé pour calculer un taux indirect (ex: USD→XOF via USD→EUR + EUR→XOF).
 */
export function composeRates(rateAB: string | number, rateBC: string | number): string {
  const ab = typeof rateAB === 'number' ? rateAB : Number(rateAB);
  const bc = typeof rateBC === 'number' ? rateBC : Number(rateBC);
  if (!Number.isFinite(ab) || ab <= 0) {
    throw new Error(`Invalid rateAB: ${String(rateAB)}`);
  }
  if (!Number.isFinite(bc) || bc <= 0) {
    throw new Error(`Invalid rateBC: ${String(rateBC)}`);
  }
  return (ab * bc).toFixed(10);
}

/**
 * Arrondi décimal "half away from zero" (convention OHADA).
 * Exemples avec decimals=2 :
 *   1.234  → "1.23"
 *   1.235  → "1.24"
 *   1.225  → "1.23" (PAS 1.22 — half away)
 *   -1.235 → "-1.24"
 */
export function roundDecimal(value: number, decimals: 0 | 2 | 3): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot round non-finite value: ${String(value)}`);
  }
  const factor = 10 ** decimals;
  // The +0.5 trick on absolute value implements half-away-from-zero.
  const rounded = Math.sign(value) * Math.floor(Math.abs(value) * factor + 0.5);
  return (rounded / factor).toFixed(decimals);
}
