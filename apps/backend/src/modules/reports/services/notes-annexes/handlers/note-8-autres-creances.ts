/**
 * Note 8 — Autres créances (Tome 3).
 *
 * Tiers débiteurs hors clients (N7) et hors fournisseurs avances (déjà
 * en N17 via 409). Couvre 42x débiteurs (personnel), 43x débiteurs
 * (organismes sociaux), 44x débiteurs (État), 47x débiteurs (comptes
 * transitoires).
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  { key: 'PERSONNEL_DEB', label: 'Personnel — créances (421, 425, 427)', prefixes: ['421', '425', '427'] },
  { key: 'ORG_SOCIAUX_DEB', label: 'Organismes sociaux — créances (438)', prefixes: ['438'] },
  { key: 'ETAT_DEB', label: "État — créances (4449, 4486, 4493-4496)", prefixes: ['4449', '4486', '4493', '4494', '4495', '4496'] },
  { key: 'COMPTES_TRANSIT', label: 'Comptes transitoires (471, 472, 473, 474, 475)', prefixes: ['471', '472', '473', '474', '475'] },
];

export const handleN8AutresCreances: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL autres créances',
  });
