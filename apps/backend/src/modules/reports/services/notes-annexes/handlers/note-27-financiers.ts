/**
 * Note 27 — Charges et produits financiers (Tome 3).
 *
 * Comptes 67 (charges financières) + 77 (revenus financiers) + 79
 * (reprises financières). Intérêts d'emprunts, escomptes accordés,
 * pertes/gains de change, revenus de placements.
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  {
    key: 'FRAIS_FIN',
    label: 'Frais financiers et charges assimilées (671, 672, 673)',
    prefixes: ['671', '672', '673'],
  },
  { key: 'PERTES_CHANGE', label: 'Pertes de change (676)', prefixes: ['676'] },
  {
    key: 'AUTRES_CHARGES_FIN',
    label: 'Autres charges financières (677, 678, 679)',
    prefixes: ['677', '678', '679'],
  },
  {
    key: 'REV_FIN_PARTICIP',
    label: 'Revenus financiers et assimilés (771, 772, 773)',
    prefixes: ['771', '772', '773'],
  },
  { key: 'GAINS_CHANGE', label: 'Gains de change (776)', prefixes: ['776'] },
  {
    key: 'AUTRES_REV_FIN',
    label: 'Autres revenus financiers (777, 778)',
    prefixes: ['777', '778'],
  },
  {
    key: 'REPRISES_FIN',
    label: 'Reprises de provisions et dépréciations financières (797, 799)',
    prefixes: ['797', '799'],
  },
];

export const handleN27Financiers: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL charges et produits financiers',
  }, ctx.periodStart);
