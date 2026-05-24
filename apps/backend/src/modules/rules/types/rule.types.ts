/**
 * Canonical types for the Rule Engine (Module 5, wave 1).
 *
 * Une règle encode une intention automatisable du type :
 *   "SI compte LIKE '62%' ET journal = 'BQ' ALORS assign cost_center = 'ADMIN'"
 *
 * Le moteur évalue les conditions sur chaque écriture source
 * (ImportStagingEntryEntity.mappedValues) et détermine les actions à
 * appliquer. L'application réelle passe toujours par TransformationService
 * (Module 4) — les écritures sources ne sont JAMAIS modifiées directement.
 *
 * Design : conditions et actions sont des tableaux de valeurs primitives
 * (union discriminée sur `type`) stockés en JSONB. Cela permet d'ajouter
 * de nouveaux opérateurs et types d'actions sans migration SQL.
 */

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/** Vérifie que le compte commence par un préfixe (`LIKE '62%'`). */
export interface AccountPrefixCondition {
  readonly type: 'account_prefix';
  /** Préfixe SYSCOHADA, ex. "62", "401", "521". */
  readonly prefix: string;
}

/** Vérifie que le compte est dans une liste exacte. */
export interface AccountInCondition {
  readonly type: 'account_in';
  readonly accounts: string[];
}

/** Vérifie que le journal est dans une liste. */
export interface JournalInCondition {
  readonly type: 'journal_in';
  readonly journals: string[];
}

/** Vérifie que le montant (débit ou crédit) est dans une plage. */
export interface AmountRangeCondition {
  readonly type: 'amount_range';
  /** 'debit' | 'credit' | 'any' — quel côté du montant comparer. */
  readonly side: 'debit' | 'credit' | 'any';
  readonly min?: number;
  readonly max?: number;
}

/** Vérifie que le libellé contient une sous-chaîne (insensible à la casse). */
export interface LabelContainsCondition {
  readonly type: 'label_contains';
  readonly substring: string;
}

/** Vérifie que la date de l'écriture est dans une plage ISO (YYYY-MM-DD). */
export interface DateRangeCondition {
  readonly type: 'date_range';
  readonly from?: string;
  readonly to?: string;
}

export type RuleCondition =
  | AccountPrefixCondition
  | AccountInCondition
  | JournalInCondition
  | AmountRangeCondition
  | LabelContainsCondition
  | DateRangeCondition;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Reclasse le compte vers un autre numéro. */
export interface ReclassifyAccountAction {
  readonly type: 'reclassify_account';
  readonly targetAccount: string;
}

/** Attribue un centre de coûts (champ analytique libre). */
export interface AssignCostCenterAction {
  readonly type: 'assign_cost_center';
  readonly costCenter: string;
}

/** Ajoute un tag/label libre sur l'écriture (via notes de transformation). */
export interface AddTagAction {
  readonly type: 'add_tag';
  readonly tag: string;
}

/** Reclasse le journal. */
export interface ReclassifyJournalAction {
  readonly type: 'reclassify_journal';
  readonly targetJournal: string;
}

export type RuleAction =
  | ReclassifyAccountAction
  | AssignCostCenterAction
  | AddTagAction
  | ReclassifyJournalAction;

// ---------------------------------------------------------------------------
// Execution scope & results
// ---------------------------------------------------------------------------

/** Périmètre passé à simulateRules / applyRules. */
export interface RuleScope {
  /** Filtrer sur un journal spécifique (ex. 'BQ', 'AC'). */
  readonly journal?: string;
  /** Filtrer sur une période ISO de début (incluse). */
  readonly dateFrom?: string;
  /** Filtrer sur une période ISO de fin (incluse). */
  readonly dateTo?: string;
  /** ID de session d'import spécifique. */
  readonly importSessionId?: string;
}

/** Résultat de l'évaluation d'une règle sur une seule écriture. */
export interface RuleMatch {
  /** ID de l'écriture source (ImportStagingEntry). */
  readonly entryId: string;
  /** Actions qui seraient (simulation) ou ont été (apply) appliquées. */
  readonly actions: RuleAction[];
  /** IDs des transformations créées (null en simulation). */
  readonly transformationIds: string[] | null;
}

/** Résultat global d'une simulation ou d'une application. */
export interface RuleExecutionResult {
  readonly ruleId: string;
  readonly mode: 'simulation' | 'apply';
  readonly matchedCount: number;
  readonly appliedCount: number;
  readonly matches: RuleMatch[];
  readonly error?: string;
}
