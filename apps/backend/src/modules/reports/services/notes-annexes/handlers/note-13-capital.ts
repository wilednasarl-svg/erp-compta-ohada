/**
 * Note 13 — Capital social et primes liées (Tome 3).
 *
 * Compte 10 : capital, primes d'émission, écarts de réévaluation.
 * Cote-créditrice naturelle (10x), excepté 109 (capital non appelé,
 * is_opposing).
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  { key: 'CAPITAL_SOCIAL', label: 'Capital social (101)', prefixes: ['101'] },
  { key: 'CAPITAL_INDIVIDUEL', label: "Capital individuel et de l'exploitant (102, 103)", prefixes: ['102', '103'] },
  { key: 'PRIMES', label: "Primes liées au capital (104)", prefixes: ['104'] },
  { key: 'ECARTS_REEVALUATION', label: 'Écarts de réévaluation (105)', prefixes: ['105'] },
  { key: 'CAPITAL_NON_APPELE', label: 'Capital souscrit non appelé (109, en déduction)', prefixes: ['109'] },
];

export const handleN13Capital: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL capital social et primes',
  });
