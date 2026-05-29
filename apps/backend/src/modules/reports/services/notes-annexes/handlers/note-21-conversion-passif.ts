/**
 * Note 21 — Écarts de conversion-passif (Tome 3).
 *
 * Comptes 479x : gains potentiels latents sur opérations en devises.
 * Sous-comptes : 4791 (créances), 4792 (dettes). Voir module
 * multi-currency pour la génération automatique à la clôture.
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  {
    key: 'EC_PASSIF_CREANCES',
    label: 'Écarts de conversion-passif sur créances (4791)',
    prefixes: ['4791'],
  },
  {
    key: 'EC_PASSIF_DETTES',
    label: 'Écarts de conversion-passif sur dettes (4792)',
    prefixes: ['4792'],
  },
];

export const handleN21ConversionPassif: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL écarts de conversion-passif',
  });
