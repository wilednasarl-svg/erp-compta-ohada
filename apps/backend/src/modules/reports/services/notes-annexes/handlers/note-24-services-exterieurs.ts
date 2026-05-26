/**
 * Note 24 — Services extérieurs et autres consommations (Tome 3).
 *
 * Comptes 61 (transports) + 62 (services A : sous-traitance, locations,
 * primes, frais bancaires) + 63 (services B : rémunérations
 * d'intermédiaires, publicité, déplacements, frais postaux,
 * formations) + 64 (impôts et taxes) + 65 (autres charges).
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  { key: 'TRANSPORTS', label: 'Transports (61)', prefixes: ['61'] },
  { key: 'SERVICES_A', label: 'Services extérieurs A (62)', prefixes: ['62'] },
  { key: 'SERVICES_B', label: 'Services extérieurs B (63)', prefixes: ['63'] },
  { key: 'IMPOTS_TAXES', label: 'Impôts et taxes (64)', prefixes: ['64'] },
  { key: 'AUTRES_CHARGES', label: 'Autres charges (65)', prefixes: ['65'] },
];

export const handleN24ServicesExterieurs: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL services extérieurs et autres consommations',
  });
