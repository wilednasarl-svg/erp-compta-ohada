/**
 * Note 1 — Référentiel comptable, méthodes et changements (SYSCOHADA).
 *
 * Note narrative qui déclare :
 *   - le référentiel applicable (SYSCOHADA révisé, AUDCIF)
 *   - les méthodes comptables retenues (CMP pour stocks, linéaire pour
 *     amortissements par défaut, etc.)
 *   - les éventuels changements de méthode sur l'exercice
 *
 * Pas de calcul automatique : rend une trame standard que le comptable
 * complète via `freeComment`. Les valeurs renvoyées ici sont des
 * libellés indicatifs (pas des montants).
 */

import type { NoteHandler, NoteRow } from '../types';

export const handleN1Referentiel: NoteHandler = async () => {
  const rows: ReadonlyArray<NoteRow> = [
    {
      key: 'REFERENTIEL',
      label: 'Référentiel comptable',
      values: {
        valeur: 'SYSCOHADA révisé (AUDCIF, applicable depuis le 1er janvier 2018)',
      },
    },
    {
      key: 'METHODE_STOCK',
      label: 'Méthode de valorisation des stocks',
      values: {
        valeur: 'Coût Moyen Pondéré (CMP) après chaque entrée',
      },
    },
    {
      key: 'METHODE_AMORT',
      label: 'Méthode d\'amortissement par défaut',
      values: {
        valeur: 'Linéaire prorata temporis',
      },
    },
    {
      key: 'METHODE_CONVERSION',
      label: 'Méthode de conversion des opérations en devises',
      values: {
        valeur: 'Cours du jour pour les transactions, cours de clôture pour les soldes monétaires',
      },
    },
    {
      key: 'CHANGEMENT_METHODE',
      label: 'Changement de méthode sur l\'exercice',
      values: {
        valeur: 'Aucun (à compléter si applicable via commentaire libre)',
      },
    },
  ];

  return { rows, applicable: true };
};
