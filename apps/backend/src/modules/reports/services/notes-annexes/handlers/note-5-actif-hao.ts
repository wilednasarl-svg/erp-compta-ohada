/**
 * Note 5 — Actif circulant HAO (Tome 3).
 *
 * Comptes 485 (créances sur cessions d'immobilisations) et 488
 * (créances HAO autres). Caractère HAO = lié à une opération hors
 * activité ordinaire (cession, indemnisation exceptionnelle...).
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  {
    key: 'CREANCES_CESSIONS_IMMO',
    label: "Créances sur cessions d'immobilisations (485)",
    prefixes: ['485'],
  },
  { key: 'CREANCES_HAO_AUTRES', label: 'Créances HAO autres (488)', prefixes: ['488'] },
];

export const handleN5ActifHao: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL actif circulant HAO',
  });
