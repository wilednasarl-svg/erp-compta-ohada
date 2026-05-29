/**
 * Note 12 — Écarts de conversion-actif (Tome 3).
 *
 * Comptes 478x : pertes potentielles latentes sur opérations en devises.
 * Sous-comptes : 4781 (créances), 4782 (dettes). Voir module
 * multi-currency pour la génération automatique à la clôture.
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  {
    key: 'EC_ACTIF_CREANCES',
    label: 'Écarts de conversion-actif sur créances (4781)',
    prefixes: ['4781'],
  },
  {
    key: 'EC_ACTIF_DETTES',
    label: 'Écarts de conversion-actif sur dettes (4782)',
    prefixes: ['4782'],
  },
];

export const handleN12ConversionActif: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL écarts de conversion-actif',
  });
