/**
 * Report Console — vocabulaire de période partagé.
 *
 * Deux sémantiques de période coexistent dans les états OHADA :
 *  - `range`  : une plage Du / Au (balances, grand livre, marge…).
 *  - `as-at`  : une date d'arrêté + le début d'exercice pour rattacher le
 *               résultat (Bilan, Ratios, Annexe…).
 *
 * Le composant `DateRangeField` consomme l'union discriminée `PeriodValue`
 * afin qu'un seul champ couvre les deux cas, sans dupliquer le formulaire
 * dans chacun des 16 panneaux d'état.
 */

export type PeriodKind = 'range' | 'as-at';

export interface RangeValue {
  readonly kind: 'range';
  readonly fromDate: string;
  readonly toDate: string;
}

export interface AsAtValue {
  readonly kind: 'as-at';
  readonly asAtDate: string;
  readonly fiscalYearStartDate: string;
}

export type PeriodValue = RangeValue | AsAtValue;

/** Statut du cycle de génération d'un état. */
export type RunStatus = 'idle' | 'running' | 'ready' | 'error';

/**
 * Indice de validité de la matière première sur la période choisie.
 * Renvoyé par le backend (endpoint léger) ou calculé. Sert à dire à
 * l'utilisateur, avant génération, si l'état sera fiable.
 */
export interface PeriodValidity {
  /**
   * Nombre d'écritures committées rattachées à la période. Optionnel : non
   * disponible tant qu'un endpoint de validité pré-génération n'existe pas
   * côté backend (la validité actuelle est dérivée du rapport généré).
   */
  readonly committedEntries?: number;
  /** Σ débit − Σ crédit sur la période, en valeur absolue (FCFA). 0 = équilibré. */
  readonly imbalance: number;
  /** Date ISO du mouvement le plus récent pris en compte. */
  readonly lastMovementDate: string | null;
  /** Horodatage ISO du calcul de cet indice (fraîcheur). */
  readonly computedAt: string;
  /** Période entièrement clôturée (verrouillée) → état définitif. */
  readonly periodClosed: boolean;
}

/** Une favori : combinaison nommée de période + périmètre, réutilisable. */
export interface ReportFavorite {
  readonly id: string;
  readonly label: string;
  readonly period: PeriodValue;
  /** Sérialisation libre du périmètre additionnel (compare, classe…). */
  readonly scope?: Readonly<Record<string, string | boolean>>;
  readonly createdAt: string;
}

/** Une entrée d'historique : un état effectivement généré. */
export interface ReportRun {
  readonly id: string;
  readonly period: PeriodValue;
  readonly scope?: Readonly<Record<string, string | boolean>>;
  readonly generatedAt: string;
  /** Durée de génération en millisecondes (affichée « généré en 1,2 s »). */
  readonly durationMs: number;
}
