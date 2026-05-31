/**
 * Note 30 — Impôt sur le résultat (Tome 3).
 *
 * Compte 89 (impôt) + 87 (participation des salariés). La réconciliation
 * taux effectif / taux nominal (cf. doctrine Tome 3) doit être saisie en
 * texte libre par le comptable — pas calculable automatiquement sans
 * connaître le taux nominal légal de l'État de résidence.
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  { key: 'IS_EXIGIBLE', label: 'Impôts sur le résultat exigibles (891)', prefixes: ['891'] },
  { key: 'IS_DIFFERES', label: 'Impôts sur le résultat différés (892)', prefixes: ['892'] },
  {
    key: 'IMPOTS_AUTRES',
    label: 'Autres impôts sur le résultat (893, 894, 895)',
    prefixes: ['893', '894', '895'],
  },
  { key: 'PARTICIPATION_SAL', label: 'Participation des travailleurs (87)', prefixes: ['87'] },
];

export const handleN30Impot: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(
    ctx.organizationId as string,
    ctx.periodEnd,
    deps,
    {
      categories: CATEGORIES,
      totalLabel: 'TOTAL impôt sur le résultat',
    },
    ctx.periodStart,
  );
