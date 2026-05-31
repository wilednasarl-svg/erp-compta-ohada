/**
 * Note 25 — Charges de personnel (Tome 3).
 *
 * Compte 66 ventilé : rémunérations directes (salaires, indemnités),
 * charges sociales patronales, rémunération de l'exploitant, autres
 * charges sociales (médecine du travail, œuvres sociales).
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  {
    key: 'REM_DIRECTES',
    label: 'Rémunérations directes versées au personnel (661)',
    prefixes: ['661'],
  },
  {
    key: 'IND_REPAS_LOG',
    label: 'Indemnités forfaitaires, repas, logement (662)',
    prefixes: ['662'],
  },
  {
    key: 'IND_PERS_EXT',
    label: 'Indemnités versées à du personnel extérieur (663)',
    prefixes: ['663'],
  },
  {
    key: 'CHARGES_SOC_OBL',
    label: 'Charges sociales obligatoires patronales (664)',
    prefixes: ['664'],
  },
  {
    key: 'CHARGES_SOC_FAC',
    label: 'Charges sociales facultatives et autres (665)',
    prefixes: ['665'],
  },
  {
    key: 'REM_EXPLOITANT',
    label: "Rémunération de l'exploitant individuel (666)",
    prefixes: ['666'],
  },
  {
    key: 'AUTRES_CHARGES_PERS',
    label: 'Autres charges sociales (667, 668)',
    prefixes: ['667', '668'],
  },
];

export const handleN25ChargesPersonnel: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL charges de personnel',
  }, ctx.periodStart);
