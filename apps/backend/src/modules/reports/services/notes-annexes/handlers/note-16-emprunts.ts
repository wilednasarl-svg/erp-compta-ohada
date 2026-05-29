/**
 * Note 16 — Emprunts et dettes financières (Tome 3).
 *
 * Comptes 16 (emprunts) + 17 (dettes de crédit-bail et assimilées) +
 * 18 (dettes liées à des participations). Ventilation par nature ; la
 * ventilation < 1 an / > 1 an est portée par les sous-comptes 16/17.
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  { key: 'EMPRUNTS_OBLIG', label: 'Emprunts obligataires (161, 162)', prefixes: ['161', '162'] },
  {
    key: 'EMPRUNTS_ETABL_CREDIT',
    label: 'Emprunts auprès des établissements de crédit (163, 164, 165)',
    prefixes: ['163', '164', '165'],
  },
  {
    key: 'AVANCES_ETAT',
    label: "Avances reçues de l'État et d'organismes publics (166, 167)",
    prefixes: ['166', '167'],
  },
  {
    key: 'AUTRES_EMPRUNTS',
    label: 'Autres emprunts et dettes assimilées (168, 169)',
    prefixes: ['168', '169'],
  },
  {
    key: 'CREDIT_BAIL',
    label: 'Dettes de crédit-bail et contrats assimilés (172, 173)',
    prefixes: ['172', '173'],
  },
  {
    key: 'DETTES_PARTICIPATIONS',
    label: 'Dettes liées à des participations (181, 182, 183, 184)',
    prefixes: ['181', '182', '183', '184'],
  },
];

export const handleN16Emprunts: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL emprunts et dettes financières',
  });
