/**
 * `CmpCalculator` — fonctions pures de valorisation Coût Moyen
 * Pondéré (CMP), méthode SYSCOHADA AUDCIF par défaut. Aucun accès DB,
 * aucun side-effect. Le service NestJS se contente de (a) charger
 * l'état courant {qty, cmp}, (b) appeler ces fonctions, (c) persister
 * le nouvel état + le mouvement.
 *
 * Précision : on travaille avec un CMP à 4 décimales (la DB stocke
 * NUMERIC(15,4) côté `current_cmp`) pour absorber les arrondis sur
 * des qty fractionnaires. Les valeurs en sortie sont des string DECIMAL.
 *
 * Formule fondamentale CMP (entrée chiffrée) :
 *     new_cmp = (qty_courante × cmp_courant + qty_entrée × prix_entrée)
 *               / (qty_courante + qty_entrée)
 *
 * Les sorties (sale) ne modifient PAS le CMP — elles sortent au CMP
 * courant ; la valeur de sortie est `qty × current_cmp`.
 */

export interface StockState {
  /** Quantité courante en stock (peut être fractionnaire pour matières au kg). */
  readonly qty: string | number;
  /** Coût Moyen Pondéré courant (à l'unité). */
  readonly cmp: string | number;
}

export interface PurchaseInput {
  /** Quantité entrant en stock (positive). */
  readonly qty: string | number;
  /** Prix unitaire d'entrée (HT, devise comptable). */
  readonly unitPrice: string | number;
}

export interface SaleInput {
  /** Quantité sortant du stock (positive). */
  readonly qty: string | number;
}

export interface AdjustmentInput {
  /** Variation de quantité (positif ou négatif). */
  readonly deltaQty: string | number;
  /**
   * Prix unitaire à appliquer si deltaQty > 0 (entrée). Pour une sortie
   * (deltaQty < 0), on sort au CMP courant — le champ est ignoré.
   */
  readonly unitPrice?: string | number;
}

export interface InventoryCountInput {
  /** Quantité physique constatée (positive). */
  readonly physicalQty: string | number;
}

export interface ValuationResult {
  /** Nouvelle quantité après le mouvement. */
  readonly qty: string;
  /** Nouveau CMP après le mouvement (string à 4 décimales). */
  readonly cmp: string;
  /**
   * Valeur monétaire engagée par CE mouvement (= delta_qty × prix_appliqué).
   * Positif = entrée comptable (débit stock), négatif = sortie (crédit stock).
   * String DECIMAL à 2 décimales (alignement DECIMAL(15,2)).
   */
  readonly movementValue: string;
}

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
 * Applique une entrée chiffrée (achat / réception). Repondère le CMP.
 *
 * Invariant : si état initial vide (qty=0), le nouveau CMP = unitPrice.
 *
 * Cas spécial : qty=0 → no-op, refusé (un mouvement à 0 quantité n'a
 * pas de sens et indique typiquement un bug applicatif).
 */
export function applyPurchase(state: StockState, input: PurchaseInput): ValuationResult {
  const qtyIn = toNum(input.qty);
  const priceIn = toNum(input.unitPrice);
  if (qtyIn <= 0) {
    throw new Error(`Purchase qty must be > 0 (got ${input.qty})`);
  }
  if (priceIn < 0) {
    throw new Error(`Purchase unitPrice cannot be negative (got ${input.unitPrice})`);
  }

  const currentQty = toNum(state.qty);
  const currentCmp = toNum(state.cmp);

  const totalValue = currentQty * currentCmp + qtyIn * priceIn;
  const newQty = currentQty + qtyIn;
  const newCmp = newQty === 0 ? 0 : totalValue / newQty;

  return {
    qty: roundTo(newQty, 4),
    cmp: roundTo(newCmp, 4),
    movementValue: roundTo(qtyIn * priceIn, 2),
  };
}

/**
 * Applique une sortie au CMP courant (vente, consommation interne).
 * Le CMP reste inchangé. Rejet si la sortie dépasse le stock disponible.
 */
export function applySale(state: StockState, input: SaleInput): ValuationResult {
  const qtyOut = toNum(input.qty);
  if (qtyOut <= 0) {
    throw new Error(`Sale qty must be > 0 (got ${input.qty})`);
  }

  const currentQty = toNum(state.qty);
  const currentCmp = toNum(state.cmp);

  // Tolerance for floating-point comparison on fractional quantities.
  if (qtyOut > currentQty + 1e-9) {
    throw new Error(
      `Sale qty (${qtyOut}) exceeds available stock (${currentQty}). ` +
        `Use an adjustment if a negative stock is intentional.`,
    );
  }

  const newQty = currentQty - qtyOut;
  return {
    qty: roundTo(newQty, 4),
    cmp: roundTo(currentCmp, 4), // unchanged
    movementValue: roundTo(-qtyOut * currentCmp, 2), // negative = exit
  };
}

/**
 * Ajustement manuel. Si deltaQty > 0, recalcule le CMP comme un purchase
 * (avec unitPrice requis). Si deltaQty < 0, sortie au CMP courant
 * (unitPrice ignoré). deltaQty = 0 → rejeté.
 */
export function applyAdjustment(state: StockState, input: AdjustmentInput): ValuationResult {
  const delta = toNum(input.deltaQty);
  if (delta === 0) {
    throw new Error('Adjustment deltaQty cannot be 0');
  }

  if (delta > 0) {
    if (input.unitPrice === undefined || input.unitPrice === null) {
      throw new Error('Positive adjustment requires a unitPrice');
    }
    return applyPurchase(state, { qty: delta, unitPrice: input.unitPrice });
  }
  return applySale(state, { qty: -delta });
}

/**
 * Inventaire physique annuel : fixe la qty au compté physique. Si
 * `physicalQty > currentQty`, on traite l'écart comme un purchase au
 * CMP courant (pas de changement de CMP, mais qty augmente). Si
 * `physicalQty < currentQty`, on traite l'écart comme une sortie au CMP.
 *
 * Convention SYSCOHADA : l'inventaire physique est l'autorité finale.
 * Les écarts sont enregistrés en compte de gestion (603x / 6037x pour
 * pertes, 71xx pour gains) — la génération de l'écriture comptable
 * est wave 2.
 */
export function applyInventoryCount(
  state: StockState,
  input: InventoryCountInput,
): ValuationResult {
  const physical = toNum(input.physicalQty);
  if (physical < 0) {
    throw new Error(`Inventory count physicalQty cannot be negative (got ${input.physicalQty})`);
  }

  const currentQty = toNum(state.qty);
  const currentCmp = toNum(state.cmp);
  const delta = physical - currentQty;

  // No change.
  if (Math.abs(delta) < 1e-9) {
    return {
      qty: roundTo(currentQty, 4),
      cmp: roundTo(currentCmp, 4),
      movementValue: '0.00',
    };
  }

  return {
    qty: roundTo(physical, 4),
    cmp: roundTo(currentCmp, 4), // CMP unchanged on inventory count
    movementValue: roundTo(delta * currentCmp, 2),
  };
}

/**
 * Calcule l'état après une suite ordonnée de mouvements. Utile pour le
 * recalcul d'un journal historique (audit, vérif intégrité). Pure :
 * pas de DB, prend la liste et un état initial.
 */
export interface HistoricalMovement {
  readonly type: 'purchase' | 'sale' | 'adjustment' | 'inventory_count';
  readonly qty: string | number;
  readonly unitPrice?: string | number;
  /** Pour `inventory_count` : qty physique. Pour `adjustment` : deltaQty. */
}

export function replayHistory(
  initialState: StockState,
  history: ReadonlyArray<HistoricalMovement>,
): ValuationResult {
  let state: StockState = {
    qty: roundTo(toNum(initialState.qty), 4),
    cmp: roundTo(toNum(initialState.cmp), 4),
  };
  let lastMovementValue = '0.00';

  for (const move of history) {
    let result: ValuationResult;
    switch (move.type) {
      case 'purchase':
        if (move.unitPrice === undefined) {
          throw new Error('purchase history entry requires unitPrice');
        }
        result = applyPurchase(state, { qty: move.qty, unitPrice: move.unitPrice });
        break;
      case 'sale':
        result = applySale(state, { qty: move.qty });
        break;
      case 'adjustment':
        result = applyAdjustment(state, { deltaQty: move.qty, unitPrice: move.unitPrice });
        break;
      case 'inventory_count':
        result = applyInventoryCount(state, { physicalQty: move.qty });
        break;
    }
    state = { qty: result.qty, cmp: result.cmp };
    lastMovementValue = result.movementValue;
  }

  return { qty: state.qty as string, cmp: state.cmp as string, movementValue: lastMovementValue };
}
