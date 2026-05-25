/**
 * Module 15 — Rapprochement bancaire (Bank reconciliation).
 *
 * Vocabulaire métier :
 *   - Compte bancaire (`bank_accounts`) : compte physique attaché à un
 *     compte du plan SYSCOHADA (typiquement 521x).
 *   - Relevé (`bank_statements`) : import d'un fichier banque pour une
 *     période donnée.
 *   - Ligne de relevé (`bank_statement_lines`) : opération individuelle
 *     (date, libellé, montant signé). Peut être `unmatched`, `matched`,
 *     ou `ignored`.
 *   - Match (`bank_reconciliation_matches`) : lien M:N entre ligne relevé
 *     et ligne d'écriture comptable.
 */

export type BankAccountStatus = 'active' | 'closed';
export type BankStatementStatus = 'imported' | 'matching' | 'reconciled';
export type BankStatementLineMatchStatus = 'unmatched' | 'matched' | 'ignored';
export type BankMatchMethod = 'auto' | 'manual' | 'imported';

export const BANK_ACCOUNT_STATUSES: ReadonlyArray<BankAccountStatus> = ['active', 'closed'];
export const BANK_STATEMENT_STATUSES: ReadonlyArray<BankStatementStatus> = [
  'imported',
  'matching',
  'reconciled',
];
export const BANK_LINE_MATCH_STATUSES: ReadonlyArray<BankStatementLineMatchStatus> = [
  'unmatched',
  'matched',
  'ignored',
];
export const BANK_MATCH_METHODS: ReadonlyArray<BankMatchMethod> = ['auto', 'manual', 'imported'];
