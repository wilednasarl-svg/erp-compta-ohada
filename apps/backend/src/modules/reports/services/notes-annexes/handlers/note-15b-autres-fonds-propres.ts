/**
 * Note 15B — Autres fonds propres (Tome 3 p. 50).
 *
 * Doctrine : capitaux propres non couverts par les notes N13 (capital),
 * N14 (réserves et report) et N15A (subventions / provisions
 * réglementées). Couvre principalement :
 *   - 104 Primes liées au capital social (sauf parts dans N13)
 *   - 105 Écarts de réévaluation (hors 106 traité en N3E)
 *   - 109 Actionnaires : capital souscrit, non appelé (déduction)
 *   - 17  Dettes de crédit-bail et contrats assimilés (volet capitaux
 *         lorsque retraités en fonds propres)
 *   - 19  Provisions financières pour risques et charges (volet
 *         capitaux propres si retraitement actuariel)
 *
 * Le handler agrège ces sous-comptes en ventilation simple : solde
 * créditeur (ressource) ou débiteur (à déduire) à la clôture. Les
 * comptes 11, 12, 13 sont déjà couverts par N14/N15A et exclus.
 */
import { computeAccountBreakdown, type BreakdownCategory } from './_account-breakdown';
import type { NoteHandler } from '../types';

const CATEGORIES: ReadonlyArray<BreakdownCategory> = [
  {
    key: 'PRIMES',
    label: 'Primes liées au capital social (104)',
    prefixes: ['104'],
  },
  {
    key: 'ECARTS',
    label: 'Écarts de réévaluation (105)',
    prefixes: ['105'],
  },
  {
    key: 'CAPITAL_NON_APPELE',
    label: 'Actionnaires : capital souscrit non appelé (109, en déduction)',
    prefixes: ['109'],
  },
  {
    key: 'AUTRES_FONDS_PROPRES',
    label: 'Autres capitaux propres (108)',
    prefixes: ['108'],
  },
  {
    key: 'EMPRUNTS_EQUIV_FONDS_PROPRES',
    label: 'Emprunts et dettes assimilées à des fonds propres (17)',
    prefixes: ['17'],
  },
];

export const handleN15bAutresFondsPropres: NoteHandler = (ctx, deps) =>
  computeAccountBreakdown(ctx.organizationId as string, ctx.periodEnd, deps, {
    categories: CATEGORIES,
    totalLabel: 'TOTAL autres fonds propres',
  });
