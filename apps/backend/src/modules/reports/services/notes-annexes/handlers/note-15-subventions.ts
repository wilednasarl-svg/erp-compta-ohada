/**
 * Note 15 — Subventions d'investissement (Tome 3).
 *
 * Compte 14 : subventions reçues pour le financement d'immobilisations.
 * Reprise étalée au compte 865 sur la durée d'amortissement du bien
 * subventionné (cf. roadmap W4.4 pour l'automation).
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  {
    key: 'SUBV_EQUIPEMENT',
    label: "Subventions d'équipement (141, 142)",
    prefixes: ['141', '142'],
  },
  { key: 'SUBV_AUTRES_BIENS', label: 'Subventions pour autres biens (143)', prefixes: ['143'] },
  {
    key: 'AUTRES_SUBVENTIONS',
    label: "Autres subventions d'investissement (148)",
    prefixes: ['148'],
  },
];

export const handleN15Subventions: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: "TOTAL subventions d'investissement",
  });
