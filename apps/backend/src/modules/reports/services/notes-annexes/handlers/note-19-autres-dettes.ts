/**
 * Note 19 — Autres dettes d'exploitation (Tome 3).
 *
 * Dettes circulantes hors fournisseurs (N17) et hors fisc/social (N18).
 * Couvre clients créditeurs (419), personnel rémunérations dues (422-428),
 * autres comptes transitoires créditeurs.
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  { key: 'CLIENTS_CREDITEURS', label: 'Clients créditeurs (419)', prefixes: ['419'] },
  { key: 'PERSONNEL_DUES', label: 'Personnel — rémunérations et charges dues (422, 423, 426, 427, 428)', prefixes: ['422', '423', '426', '427', '428'] },
  { key: 'PRODUITS_CONSTATES_AVANCE', label: "Produits constatés d'avance (477)", prefixes: ['477'] },
  { key: 'COMPTES_TRANSIT_CRED', label: 'Comptes transitoires créditeurs (476 inversé non couvert ici ; 481, 488)', prefixes: ['481', '488'] },
];

export const handleN19AutresDettes: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: "TOTAL autres dettes d'exploitation",
  });
