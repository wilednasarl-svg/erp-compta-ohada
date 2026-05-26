/**
 * Note 14 — Réserves et report à nouveau (Tome 3).
 *
 * Comptes 11 (réserves) + 12 (report à nouveau et résultat) — capitaux
 * propres internes générés par l'activité passée.
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  { key: 'RESERVE_LEGALE', label: 'Réserve légale (111)', prefixes: ['111'] },
  { key: 'RESERVES_STATUTAIRES', label: 'Réserves statutaires ou contractuelles (112)', prefixes: ['112'] },
  { key: 'RESERVES_REGLEMENTEES', label: 'Réserves réglementées (113)', prefixes: ['113'] },
  { key: 'AUTRES_RESERVES', label: 'Autres réserves (118)', prefixes: ['118'] },
  { key: 'REPORT_A_NOUVEAU', label: 'Report à nouveau créditeur (120)', prefixes: ['120'] },
  { key: 'REPORT_DEBITEUR', label: 'Report à nouveau débiteur (121, en déduction)', prefixes: ['121'] },
  { key: 'RESULTAT_NET', label: "Résultat net de l'exercice (130, 139)", prefixes: ['130', '131', '132', '133', '139'] },
];

export const handleN14ReservesReport: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL réserves et report à nouveau',
  });
