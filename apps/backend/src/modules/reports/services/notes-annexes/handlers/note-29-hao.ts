/**
 * Note 29 — Charges et produits HAO (Tome 3).
 *
 * Comptes 81 (charges sur cessions d'immo) + 82 (produits cessions
 * immo) + 83 (charges HAO) + 84 (produits HAO) + 86 (reprises HAO).
 * Hors activité ordinaire = caractère inhabituel ou non répétitif.
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  {
    key: 'VCEAC',
    label: "Valeurs comptables des cessions d'immo (811, 812)",
    prefixes: ['811', '812'],
  },
  {
    key: 'PROD_CESSIONS_IMMO',
    label: "Produits des cessions d'immobilisations (821, 822, 826)",
    prefixes: ['821', '822', '826'],
  },
  {
    key: 'CHARGES_HAO',
    label: 'Charges HAO (831, 832, 834, 835, 836, 838)',
    prefixes: ['831', '832', '834', '835', '836', '838'],
  },
  {
    key: 'PRODUITS_HAO',
    label: 'Produits HAO (841, 845, 846, 848)',
    prefixes: ['841', '845', '846', '848'],
  },
  { key: 'DOTATIONS_HAO', label: 'Dotations HAO (851, 853, 854)', prefixes: ['851', '853', '854'] },
  {
    key: 'REPRISES_HAO',
    label: 'Reprises HAO (861, 862, 864, 865)',
    prefixes: ['861', '862', '864', '865'],
  },
];

export const handleN29Hao: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(
    ctx.organizationId as string,
    ctx.periodEnd,
    deps,
    {
      categories: CATEGORIES,
      totalLabel: 'TOTAL charges et produits HAO',
    },
    ctx.periodStart,
  );
