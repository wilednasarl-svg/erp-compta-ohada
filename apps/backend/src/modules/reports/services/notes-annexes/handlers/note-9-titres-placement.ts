/**
 * Note 9 — Titres de placement (Tome 3).
 *
 * Comptes 50x : valeurs mobilières de placement, parts dans des fonds
 * communs, bons du Trésor à court terme, autres titres détenus pour
 * réalisation rapide.
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  { key: 'TITRES_PROPRE', label: 'Titres du Trésor et bons de caisse (501)', prefixes: ['501'] },
  { key: 'ACTIONS', label: 'Actions (502)', prefixes: ['502'] },
  { key: 'OBLIGATIONS', label: 'Obligations (503)', prefixes: ['503'] },
  { key: 'BONS_SOUSCRIPTION', label: 'Bons de souscription (504)', prefixes: ['504'] },
  { key: 'AUTRES_VMP', label: 'Autres titres de placement (505-508)', prefixes: ['505', '506', '507', '508'] },
];

export const handleN9TitresPlacement: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL titres de placement',
  });
