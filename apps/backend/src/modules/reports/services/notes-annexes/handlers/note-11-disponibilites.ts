/**
 * Note 11 — Disponibilités (Tome 3).
 *
 * Comptes 52-57 : banques (locales et étrangères), chèques postaux,
 * Trésor, mobile money, caisse, régies d'avances.
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  { key: 'BANQUES_LOCALES', label: 'Banques locales (521)', prefixes: ['521'] },
  { key: 'BANQUES_ETRANGERES', label: 'Banques étrangères (522)', prefixes: ['522'] },
  { key: 'CHEQUES_POSTAUX', label: 'Chèques postaux (531)', prefixes: ['531'] },
  { key: 'TRESOR', label: 'Trésor public (532)', prefixes: ['532'] },
  { key: 'MOBILE_MONEY', label: 'Mobile money et monnaie électronique (541)', prefixes: ['541'] },
  { key: 'CAISSE', label: 'Caisse (571)', prefixes: ['571'] },
  { key: 'REGIES_AVANCES', label: "Régies d'avances et accréditifs (581, 588)", prefixes: ['581', '588'] },
];

export const handleN11Disponibilites: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL disponibilités',
  });
