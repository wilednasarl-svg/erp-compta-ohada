/**
 * E1 — Sûretés réelles données par l'entité (Tome 3 p. 35).
 *
 * Types canoniques pour le module `pledged-assets`. Chaque sûreté
 * (hypothèque, nantissement, gage, caution réelle, autre) est attachée
 * à une dette financière (compte 16x, 17x, 18x ou 4x partiel) et
 * référence l'actif donné en garantie (titre foncier, fonds de
 * commerce, équipement…).
 *
 * Doctrine N1 :
 *   « Emprunts et dettes des établissements de crédit : 100 000 000 |
 *     Hypothèque sur ensemble immobilier sis à Kalala (TF 456N23)
 *     garantissant l'emprunt London City le 13/08/N »
 *
 * Vue miroir N16Bbis : passifs garantis par les actifs nantis donnés.
 */

/**
 * Nature juridique de la sûreté réelle constituée. Liste fermée pour
 * permettre l'agrégation par type dans la note annexe (colonnes
 * « Hypothèques | Nantissements | Gages | autres »).
 */
export type PledgeType =
  | 'hypotheque'
  | 'nantissement'
  | 'gage'
  | 'caution'
  | 'autre';

/**
 * Cycle de vie d'une sûreté.
 *   - `active`    : sûreté en vigueur ; figure dans les notes annexes.
 *   - `released`  : main-levée enregistrée ; n'apparaît plus dans la
 *     liasse à compter de `releasedAt`.
 *   - `cancelled` : annulation administrative (erreur de saisie,
 *     doublon) ; jamais reportée dans les notes.
 */
export type PledgeStatus = 'active' | 'released' | 'cancelled';

/**
 * Mapping NoteRow ↔ PledgeType — libellés humains repris tels quels
 * dans la colonne « Sûretés réelles » de la note 1.
 */
export const PLEDGE_TYPE_LABELS: Readonly<Record<PledgeType, string>> = {
  hypotheque: 'Hypothèque',
  nantissement: 'Nantissement',
  gage: 'Gage',
  caution: 'Caution réelle',
  autre: 'Autre sûreté',
};

/**
 * Liste exhaustive des types de sûreté — utilisé par la validation DTO
 * et les tests pour exercer chaque branche.
 */
export const ALL_PLEDGE_TYPES: ReadonlyArray<PledgeType> = [
  'hypotheque',
  'nantissement',
  'gage',
  'caution',
  'autre',
];

/**
 * Snapshot consommé par les handlers de notes annexes (N1 + N16Bbis).
 * Découplage volontaire de `PledgedAssetEntity` : pas d'import inverse
 * des entités TypeORM dans le moteur de notes (cycle DI évité).
 *
 * Tous les montants sont des `string` DECIMAL(15,2) — conventions du
 * registry de notes.
 */
export interface PledgedAssetSnapshot {
  readonly id: string;
  readonly liabilityAccountCode: string;
  readonly liabilityLabel: string;
  readonly brutAmount: string;
  readonly pledgeType: PledgeType;
  readonly pledgeTypeLabel: string;
  readonly assetReference: string;
  readonly assetLocation: string | null;
  readonly creditorName: string;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly status: PledgeStatus;
  readonly comment: string | null;
}
