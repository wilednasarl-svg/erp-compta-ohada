/**
 * Système comptable OHADA (Acte Uniforme révisé, applicable depuis le
 * 1ᵉʳ janvier 2018). Une organisation est rattachée à exactement un
 * système, fixé à sa création et immuable ensuite (cf. design.md D2).
 *
 * - `NORMAL`   — Système Normal. PME et grandes entreprises. Plan
 *                comptable complet (~800 comptes), états financiers
 *                complets (Bilan, Compte de résultat, TAFIRE, Notes
 *                annexes), comptabilité d'engagement.
 * - `MINIMAL`  — Système Minimal de Trésorerie (SMT). Très petites
 *                entités sous certains seuils de chiffre d'affaires
 *                (cf. art. 13 AUDCIF). Comptabilité d'encaissement,
 *                plan réduit (~400 comptes, focus classes 5/6/7).
 * - `ALLEGE`   — Système Allégé. Entités intermédiaires. Plan
 *                intermédiaire (~600 comptes), états financiers
 *                simplifiés.
 */
export const ACCOUNTING_SYSTEMS = ['NORMAL', 'MINIMAL', 'ALLEGE'] as const;
export type AccountingSystem = (typeof ACCOUNTING_SYSTEMS)[number];

/**
 * Type d'un compte au sens de la hiérarchie SYSCOHADA :
 *  - `TITLE`   : compte de regroupement (nœud), non mouvementable par
 *                les écritures (ex : `4 — Tiers`, `41 — Clients`,
 *                `411 — Clients`).
 *  - `POSTING` : compte terminal (feuille), seul autorisé comme cible
 *                d'écriture comptable au Module 3 (ex : `4111`).
 */
export type AccountType = 'TITLE' | 'POSTING';

/**
 * Sens normal d'un compte : `D` (Débit) ou `C` (Crédit). Dérivé de la
 * classe pour les classes 1, 2, 3, 5, 6, 7 ; fixé compte par compte
 * pour les classes 4, 8, 9 où la convention est variable.
 */
export type NormalBalance = 'D' | 'C';

/**
 * Ligne du plan comptable de référence OHADA. Un même compte peut être
 * applicable à un ou plusieurs systèmes (par exemple `411` est dans le
 * Normal et l'Allégé mais pas dans le Minimal).
 */
export interface ReferenceAccountSeed {
  readonly code: string;
  readonly label: string;
  readonly class: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly account_type: AccountType;
  readonly normal_balance: NormalBalance;
  readonly applicable_systems: ReadonlyArray<AccountingSystem>;
  /**
   * `is_opposing = true` → compte au sens normal opposé à sa classe
   * (sous-classes 29x/39x/49x/59x, 109, 121, 129, 409). Optionnel —
   * non spécifié = false. Voir migration 0090 et `ReferenceAccountEntity.isOpposing`.
   *
   * Le backfill est fait par la migration 0090 elle-même (sur tous
   * les comptes déjà insérés). Cette propriété sert aux seeds neufs
   * qui seront ajoutés après 0090.
   */
  readonly is_opposing?: boolean;
}
