/**
 * Note 6 — Stocks et en-cours (ventilation par type).
 *
 * Ventile la valeur des stocks à la clôture selon les familles
 * SYSCOHADA :
 *   - 31 : Marchandises
 *   - 32 : Matières premières
 *   - 33 : Autres approvisionnements
 *   - 34/35 : En-cours
 *   - 36 : Produits finis
 *   - 37 : En cours de route
 *
 * Valeur par article = currentQty × currentCmp. Source de vérité :
 * `inventory_items` (compteurs maintenus par InventoryMovementsService).
 */

import type { NoteHandler, NoteInventoryItem, NoteRow } from '../types';
import { STOCK_FAMILY_LABELS } from '../types';

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

const FAMILY_ORDER: ReadonlyArray<NoteInventoryItem['family']> = [
  'marchandises',
  'matieres',
  'fournitures',
  'en_cours',
  'produits_finis',
  'en_route',
];

export const handleN6Stocks: NoteHandler = async (ctx, deps) => {
  const items = await deps.inventory.findAllItems(ctx.organizationId);

  const totalsByFamily = new Map<NoteInventoryItem['family'], { value: number; count: number }>();
  for (const fam of FAMILY_ORDER) totalsByFamily.set(fam, { value: 0, count: 0 });

  for (const item of items) {
    const qty = num(item.currentQty);
    const cmp = num(item.currentCmp);
    const value = qty * cmp;
    const slot = totalsByFamily.get(item.family);
    if (slot) {
      slot.value += value;
      slot.count += 1;
    }
  }

  let grandTotal = 0;
  const rows: NoteRow[] = FAMILY_ORDER.map((fam) => {
    const slot = totalsByFamily.get(fam)!;
    grandTotal += slot.value;
    return {
      key: fam.toUpperCase(),
      label: STOCK_FAMILY_LABELS[fam],
      values: {
        nbArticles: String(slot.count),
        valeur: fmt(slot.value),
      },
    };
  });

  rows.push({
    key: 'TOTAL',
    label: 'TOTAL stocks',
    values: {
      nbArticles: String(items.length),
      valeur: fmt(grandTotal),
    },
  });

  return { rows, applicable: items.length > 0 };
};
