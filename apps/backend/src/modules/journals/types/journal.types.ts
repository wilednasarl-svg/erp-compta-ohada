/**
 * Types et constantes du Module 8 — Journals & Entries.
 *
 * SYSCOHADA AUDCIF :
 *   - 5 journaux standards seedés à la création d'une organisation.
 *   - Statut machine à 3 états sur une entry :
 *       draft → validated → cancelled (via contre-passation)
 *   - Une période comptable est : annuelle (exercice), trimestrielle ou
 *     mensuelle. La hiérarchie est matérialisée par `parent_id`.
 */

/**
 * 5 journaux SYSCOHADA standards seedés à la création d'org.
 *
 * Une org peut ajouter des sous-journaux personnalisés via
 * `POST /journals` (ex: `BQ-01`, `BQ-02` pour plusieurs banques).
 */
export type JournalKind = 'AC' | 'VE' | 'BQ' | 'CA' | 'OD';

export interface StandardJournalSeed {
  readonly code: JournalKind;
  readonly label: string;
  readonly kind: JournalKind;
}

export const STANDARD_JOURNALS: ReadonlyArray<StandardJournalSeed> = [
  { code: 'AC', label: 'Journal des Achats', kind: 'AC' },
  { code: 'VE', label: 'Journal des Ventes', kind: 'VE' },
  { code: 'BQ', label: 'Journal de Banque', kind: 'BQ' },
  { code: 'CA', label: 'Journal de Caisse', kind: 'CA' },
  { code: 'OD', label: 'Journal des Opérations Diverses', kind: 'OD' },
];

/**
 * Statut machine d'une écriture comptable.
 *
 *   - `draft`     : modifiable, supprimable.
 *   - `validated` : immutable. La seule façon de corriger une erreur
 *     est de contre-passer (créer une entry inverse).
 *   - `cancelled` : original contre-passé par une autre entry qui
 *     pointe `cancels: <originalId>`. Lecture seule.
 */
export type JournalEntryStatus = 'draft' | 'validated' | 'cancelled';

/**
 * Type de période comptable.
 *
 *   - `ANNUAL`    : exercice complet (parent).
 *   - `QUARTERLY` : trimestre (enfant d'un ANNUAL).
 *   - `MONTHLY`   : mois (enfant d'un ANNUAL ou QUARTERLY).
 *
 * Le découpage est fixé à la création de l'année (`MONTHLY` ou
 * `QUARTERLY` — pas les deux à la fois).
 */
export type AccountingPeriodKind = 'ANNUAL' | 'QUARTERLY' | 'MONTHLY';

export type AccountingPeriodStatus = 'open' | 'closed';

/**
 * Découpage choisi à la création d'un exercice.
 *
 *   - `MONTHLY`      : exercice + 12 sous-périodes mensuelles.
 *   - `QUARTERLY`    : exercice + 4 sous-périodes trimestrielles.
 *   - `ANNUAL_ONLY`  : exercice sans sous-périodes (utilisé pour les
 *     très petites entités en Système Minimal de Trésorerie).
 */
export type FiscalYearSplit = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL_ONLY';
