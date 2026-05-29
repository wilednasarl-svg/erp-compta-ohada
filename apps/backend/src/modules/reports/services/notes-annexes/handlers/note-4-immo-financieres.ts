/**
 * Note 4 — Immobilisations financières (Tome 3).
 *
 * Comptes 26 (titres de participation) + 27 (autres immo financières :
 * créances rattachées, prêts, dépôts et cautionnements).
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  { key: 'TITRES_PARTICIPATION', label: 'Titres de participation (26)', prefixes: ['26'] },
  {
    key: 'CREANCES_RATTACHEES',
    label: 'Créances rattachées à des participations (271)',
    prefixes: ['271'],
  },
  { key: 'PRETS', label: 'Prêts (272, 273, 274)', prefixes: ['272', '273', '274'] },
  {
    key: 'DEPOTS_CAUTIONNEMENTS',
    label: 'Dépôts et cautionnements versés (275)',
    prefixes: ['275'],
  },
  {
    key: 'AUTRES',
    label: 'Autres immobilisations financières (276-279)',
    prefixes: ['276', '277', '278', '279'],
  },
];

export const handleN4ImmoFinancieres: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL immobilisations financières',
  });
