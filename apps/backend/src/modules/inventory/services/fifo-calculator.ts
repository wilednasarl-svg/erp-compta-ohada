/**
 * `FifoCalculator` — fonctions pures de valorisation FIFO (W4.2).
 *
 * Méthode "First In, First Out" : à chaque sortie, on consomme les lots
 * dans l'ordre chronologique d'entrée jusqu'à couvrir la quantité
 * demandée. Le coût total de la sortie est la somme des
 * (qty_consommée × unitCost) par lot. Si la queue est insuffisante,
 * `remainingShortage > 0` signale le déficit au service appelant qui
 * lèvera `INVENTORY_FIFO_INSUFFICIENT_STOCK`.
 *
 * Aucun accès DB, aucun side-effect. Les valeurs en sortie sont des
 * strings DECIMAL (alignement DECIMAL(15,4) côté DB).
 */

export interface FifoLot {
  readonly id: string;
  /** Quantité encore disponible dans le lot (>= 0). */
  readonly remainingQty: string | number;
  /** Coût unitaire d'entrée du lot. */
  readonly unitCost: string | number;
}

export interface FifoConsumedLine {
  readonly lotId: string;
  /** Quantité consommée sur CE lot. */
  readonly qty: string;
  /** Coût unitaire du lot (rappel — utile pour générer la trace). */
  readonly unitCost: string;
}

export interface FifoConsumeResult {
  /** Lignes de consommation, dans l'ordre FIFO. */
  readonly consumed: ReadonlyArray<FifoConsumedLine>;
  /** Coût total = somme(qty × unitCost). String DECIMAL 2 décimales. */
  readonly totalCost: string;
  /**
   * Quantité non couverte par la queue (déficit). 0 si tout a été
   * absorbé. Le service appelant doit lever une erreur si > 0.
   */
  readonly remainingShortage: string;
}

const QTY_DECIMALS = 4;
const COST_DECIMALS = 2;

function toNum(v: string | number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid numeric value: ${String(v)}`);
  }
  return n;
}

/** Arrondi half-away-from-zero à N décimales (convention OHADA). */
function roundTo(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot round non-finite value: ${String(value)}`);
  }
  const factor = 10 ** decimals;
  const rounded = Math.sign(value) * Math.floor(Math.abs(value) * factor + 0.5);
  return (rounded / factor).toFixed(decimals);
}

/**
 * Consomme `requestedQty` depuis la queue ordonnée `lots` (déjà triée
 * dans l'ordre FIFO par l'appelant). Pure fonction : ne mute pas les
 * lots, retourne uniquement la décomposition de la consommation.
 *
 * Invariants :
 *  - `consumed` ne contient que des lignes avec `qty > 0`.
 *  - `sum(consumed.qty) + remainingShortage = requestedQty`.
 *  - `totalCost = sum(consumed.qty × unitCost)`.
 *  - Queue vide ou requestedQty = 0 → totalCost = 0,
 *    remainingShortage = requestedQty.
 */
export function consumeFromLots(
  lots: ReadonlyArray<FifoLot>,
  requestedQty: string | number,
): FifoConsumeResult {
  const requested = toNum(requestedQty);
  if (requested < 0) {
    throw new Error(`Requested qty cannot be negative (got ${String(requestedQty)})`);
  }
  if (requested === 0) {
    return {
      consumed: [],
      totalCost: roundTo(0, COST_DECIMALS),
      remainingShortage: roundTo(0, QTY_DECIMALS),
    };
  }

  const consumed: FifoConsumedLine[] = [];
  let remaining = requested;
  let totalCost = 0;

  for (const lot of lots) {
    if (remaining <= 1e-9) break;
    const available = toNum(lot.remainingQty);
    if (available <= 0) continue;
    const unitCost = toNum(lot.unitCost);

    const take = Math.min(available, remaining);
    consumed.push({
      lotId: lot.id,
      qty: roundTo(take, QTY_DECIMALS),
      unitCost: roundTo(unitCost, QTY_DECIMALS),
    });
    totalCost += take * unitCost;
    remaining -= take;
  }

  const shortage = remaining > 1e-9 ? remaining : 0;

  return {
    consumed,
    totalCost: roundTo(totalCost, COST_DECIMALS),
    remainingShortage: roundTo(shortage, QTY_DECIMALS),
  };
}
