/**
 * Note 10 — Valeurs à encaisser (Tome 3).
 *
 * Comptes 51x : effets à encaisser, chèques à encaisser, coupons échus,
 * mandats à encaisser. Distinct des disponibilités (52-57, voir N11).
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  { key: 'EFFETS_ENCAISSEMENT', label: 'Effets à encaisser (511)', prefixes: ['511'] },
  { key: 'EFFETS_ESCOMPTE', label: "Effets à l'encaissement (512)", prefixes: ['512'] },
  { key: 'CHEQUES_ENCAISSER', label: 'Chèques à encaisser (513)', prefixes: ['513'] },
  { key: 'COUPONS_ECHUS', label: 'Coupons échus (514)', prefixes: ['514'] },
  { key: 'CARTES_BANCAIRES', label: 'Cartes bancaires à encaisser (515)', prefixes: ['515'] },
  {
    key: 'AUTRES_VAE',
    label: 'Autres valeurs à encaisser (516-519)',
    prefixes: ['516', '517', '518', '519'],
  },
];

export const handleN10ValeursEncaisser: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL valeurs à encaisser',
  });
