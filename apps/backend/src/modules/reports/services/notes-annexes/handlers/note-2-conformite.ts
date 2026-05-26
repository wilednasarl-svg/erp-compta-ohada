/**
 * Note 2 — Déclaration de conformité au PCGO (Plan Comptable Général
 * OHADA).
 *
 * Note structurée mais essentiellement narrative : une case à cocher
 * "conformité totale" + le détail des éventuelles dérogations.
 *
 * Rendu : une seule ligne "DECLARATION" portant un libellé standard.
 * Le comptable adapte via `freeComment` s'il y a des dérogations
 * (rare).
 */

import type { NoteHandler, NoteRow } from '../types';

export const handleN2Conformite: NoteHandler = async () => {
  const rows: ReadonlyArray<NoteRow> = [
    {
      key: 'DECLARATION',
      label: 'Déclaration de conformité',
      values: {
        statut: 'CONFORME',
        texte:
          'Les états financiers annuels ont été établis conformément au PCGO ' +
          "(Acte uniforme AUDCIF révisé). Aucune dérogation n'a été appliquée.",
      },
    },
  ];

  return { rows, applicable: true };
};
