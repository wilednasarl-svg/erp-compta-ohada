/**
 * Note 20 — Concours bancaires courants (Tome 3).
 *
 * Compte 56 : crédits de trésorerie reçus, soldes créditeurs de banques,
 * escomptes commerciaux, escomptes de crédits ordinaires.
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  { key: 'CREDITS_TRESORERIE', label: 'Crédits de trésorerie (561)', prefixes: ['561'] },
  { key: 'CREDITS_ESCOMPTE', label: "Crédits d'escompte commerciaux (564)", prefixes: ['564'] },
  { key: 'CREDIT_ORDINAIRE', label: 'Escomptes de crédits ordinaires (565)', prefixes: ['565'] },
  {
    key: 'SOLDES_CRED_BQE',
    label: 'Banques, soldes créditeurs (566, 569)',
    prefixes: ['566', '569'],
  },
];

export const handleN20ConcoursBancaires: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL concours bancaires courants',
  });
