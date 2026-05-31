/**
 * Note 23 — Achats consommés (Tome 3).
 *
 * Compte 60 : achats par nature (marchandises, matières, emballages,
 * fournitures non stockables, eau/énergie, services rattachés).
 * Variations de stocks (603) inclus pour matérialiser la consommation
 * nette (« achats nets de variations »).
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  { key: 'ACHATS_MARCHANDISES', label: 'Achats de marchandises (601)', prefixes: ['601'] },
  { key: 'ACHATS_MATIERES', label: 'Achats de matières premières (602)', prefixes: ['602'] },
  { key: 'VAR_STOCKS', label: 'Variations des stocks de biens achetés (603)', prefixes: ['603'] },
  {
    key: 'AUTRES_APPROS',
    label: 'Autres approvisionnements (604, 605, 608)',
    prefixes: ['604', '605', '608'],
  },
  {
    key: 'EAU_ENERGIE',
    label: 'Eau, électricité, autres énergies (605 détail)',
    prefixes: ['6051', '6052', '6053'],
  },
  { key: 'EMBALLAGES', label: 'Emballages (608)', prefixes: ['608'] },
];

export const handleN23Achats: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL achats consommés',
  }, ctx.periodStart);
