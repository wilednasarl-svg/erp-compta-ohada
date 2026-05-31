/**
 * Note 23 — Achats consommés (Tome 3).
 *
 * Compte 60 : achats par nature (marchandises, matières, emballages,
 * fournitures non stockables, eau/énergie, services rattachés).
 * Variations de stocks (603) inclus pour matérialiser la consommation
 * nette (« achats nets de variations »).
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

// Catégories MUTUELLEMENT EXCLUSIVES : `computeAccountBreakdown` attribue
// chaque compte à la PREMIÈRE catégorie dont un préfixe matche. Les
// anciennes catégories EAU_ENERGIE (6051-6053) et EMBALLAGES (608)
// venaient APRÈS « Autres approvisionnements (604,605,608) » qui captait
// déjà 605/608 → elles restaient toujours à 0 (lignes mortes). On éclate
// désormais 604 / 605 / 608 en lignes distinctes (le total est inchangé,
// chaque compte 60x reste compté une seule fois).
const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  { key: 'ACHATS_MARCHANDISES', label: 'Achats de marchandises (601)', prefixes: ['601'] },
  { key: 'ACHATS_MATIERES', label: 'Achats de matières premières (602)', prefixes: ['602'] },
  { key: 'VAR_STOCKS', label: 'Variations des stocks de biens achetés (603)', prefixes: ['603'] },
  {
    key: 'AUTRES_APPROS',
    label: 'Autres achats — matières et fournitures consommables (604)',
    prefixes: ['604'],
  },
  {
    key: 'EAU_ENERGIE',
    label: 'Fournitures non stockables — eau, électricité, énergie (605)',
    prefixes: ['605'],
  },
  { key: 'EMBALLAGES', label: "Achats d'emballages (608)", prefixes: ['608'] },
];

export const handleN23Achats: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(
    ctx.organizationId as string,
    ctx.periodEnd,
    deps,
    {
      categories: CATEGORIES,
      totalLabel: 'TOTAL achats consommés',
    },
    ctx.periodStart,
  );
