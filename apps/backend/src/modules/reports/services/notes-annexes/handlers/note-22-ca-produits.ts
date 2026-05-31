/**
 * Note 22 — Chiffre d'affaires et autres produits (Tome 3).
 *
 * Comptes 70 (ventes) à 75 (autres produits). Les comptes 76/77/78/79
 * sont couverts par N27 (financiers), N26 (reprises) et le HAO N29.
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  { key: 'VENTES_MARCHANDISES', label: 'Ventes de marchandises (701)', prefixes: ['701'] },
  {
    key: 'VENTES_PRODUITS',
    label: 'Ventes de produits fabriqués (702, 703, 704)',
    prefixes: ['702', '703', '704'],
  },
  {
    key: 'TRAVAUX_SERVICES',
    label: 'Travaux et services vendus (705, 706)',
    prefixes: ['705', '706'],
  },
  {
    key: 'PRODUITS_ACCESSOIRES',
    label: 'Produits accessoires (707, 708)',
    prefixes: ['707', '708'],
  },
  { key: 'SUBVENTIONS_EXPL', label: "Subventions d'exploitation (71)", prefixes: ['71'] },
  { key: 'PRODUCTION_IMMOB', label: 'Production immobilisée (72)', prefixes: ['72'] },
  {
    key: 'VARIATIONS_STOCKS_PROD',
    label: 'Variations des stocks de biens et services produits (73)',
    prefixes: ['73'],
  },
  { key: 'AUTRES_PRODUITS', label: 'Autres produits (75)', prefixes: ['75'] },
];

export const handleN22CaProduits: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: "TOTAL chiffre d'affaires et autres produits d'exploitation",
  }, ctx.periodStart);
