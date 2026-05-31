/**
 * Note 26 — Dotations aux amortissements et provisions (Tome 3).
 *
 * Comptes 68 (dotations d'exploitation) + 69 (dotations financières) +
 * 85 (dotations HAO). Recoupe partiellement N3D (amortissements) pour
 * la partie exploitation des immobilisations.
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  {
    key: 'DOT_AMORT',
    label: "Dotations aux amortissements d'exploitation (681)",
    prefixes: ['681'],
  },
  {
    key: 'DOT_PROV_EXPL',
    label: "Dotations aux provisions d'exploitation (691)",
    prefixes: ['691'],
  },
  {
    key: 'DOT_DEPRECIATIONS_EXPL',
    label: "Dotations aux dépréciations d'exploitation (659)",
    prefixes: ['659'],
  },
  {
    key: 'DOT_AMORT_FIN',
    label: 'Dotations aux amortissements financiers (687)',
    prefixes: ['687'],
  },
  { key: 'DOT_PROV_FIN', label: 'Dotations aux provisions financières (697)', prefixes: ['697'] },
  { key: 'DOT_HAO', label: 'Dotations HAO (854, 853)', prefixes: ['853', '854'] },
];

export const handleN26Dotations: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL dotations aux amortissements et provisions',
  }, ctx.periodStart);
