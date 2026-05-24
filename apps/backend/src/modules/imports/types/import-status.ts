/**
 * Type vocabulary for the import pipeline. Centralising the literal
 * unions here keeps the entity columns, DTO validators, services and
 * tests aligned — adding a new status requires a single edit and the
 * compiler then flags every consumer that must handle it.
 *
 * The DB enforces the same sets via CHECK constraints (see migrations
 * 0015, 0016). If you extend a union here, also extend the matching
 * CHECK — a forgotten side will desync schema and runtime.
 */

/**
 * Lifecycle of an `ImportSession`:
 *
 *   draft         — session row created, no file uploaded yet.
 *   parsing       — a file has been uploaded and the parser is running.
 *   parsed        — parsing finished, staging rows exist with raw_values.
 *   validated     — mapping + validation finished, every staging row has
 *                   `errors` populated (possibly empty).
 *   ready_for_import — explicit human acknowledgement that the user
 *                   intends to commit the staging into real accounting
 *                   tables (Module 3 wave 2).
 *   completed     — staging committed into accounting tables (Module 3
 *                   wave 2 / Module 4).
 *   failed        — terminal failure at any earlier step.
 */
export type ImportSessionStatus =
  | 'draft'
  | 'parsing'
  | 'parsed'
  | 'validated'
  | 'ready_for_import'
  | 'completed'
  | 'failed';

export const IMPORT_SESSION_STATUSES: readonly ImportSessionStatus[] = [
  'draft',
  'parsing',
  'parsed',
  'validated',
  'ready_for_import',
  'completed',
  'failed',
] as const;

/**
 * Allowed status transitions for an import session (audit Module 3
 * Code-H1).
 *
 *   draft           → parsing | failed
 *   parsing         → parsed | failed
 *   parsed          → parsing  (re-parse, e.g. user fixed mapping)
 *                   | validated | failed
 *   validated       → ready_for_import | parsed (back-edit) | failed
 *   ready_for_import → completed | failed
 *   completed       → ∅ (terminal)
 *   failed          → draft  (operator-driven reset only, never
 *                              auto — explicit reopen for retry)
 *
 * `updateStatus` MUST consult this map and refuse any transition not
 * listed. Without this guard, any future call site could push a
 * session straight from `draft` to `completed` and bypass the
 * validation pipeline.
 */
export const VALID_STATUS_TRANSITIONS: Readonly<
  Record<ImportSessionStatus, ReadonlySet<ImportSessionStatus>>
> = {
  draft: new Set(['parsing', 'failed']),
  parsing: new Set(['parsed', 'failed']),
  parsed: new Set(['parsing', 'validated', 'failed']),
  validated: new Set(['ready_for_import', 'parsed', 'failed']),
  ready_for_import: new Set(['completed', 'failed']),
  completed: new Set([]),
  failed: new Set(['draft']),
};

export function canTransitionTo(from: ImportSessionStatus, to: ImportSessionStatus): boolean {
  return VALID_STATUS_TRANSITIONS[from].has(to);
}

/**
 * Format declared at session creation. The parser still auto-detects
 * the MIME at runtime — `sourceType` is the user's *intent*, not the
 * runtime authority. Useful for dashboards ("imports Sage du mois").
 */
export type ImportSourceType = 'csv' | 'excel' | 'sage' | 'txt';

export const IMPORT_SOURCE_TYPES: readonly ImportSourceType[] = [
  'csv',
  'excel',
  'sage',
  'txt',
] as const;

/**
 * Lifecycle of a single `ImportFile` row (independent of the session).
 *
 *   uploaded      — bytes written, checksum computed, parse not started.
 *   parsing       — parser is currently iterating the file.
 *   parsed        — every row produced a staging entry (with or without
 *                   validation errors — those are per-row, not file-level).
 *   parse_failed  — fatal parser error (corrupt file, wrong encoding,
 *                   header missing). `parseError` carries the message.
 */
export type ImportFileStatus = 'uploaded' | 'parsing' | 'parsed' | 'parse_failed';

export const IMPORT_FILE_STATUSES: readonly ImportFileStatus[] = [
  'uploaded',
  'parsing',
  'parsed',
  'parse_failed',
] as const;

/**
 * A single validation finding attached to one staging row. Stored as
 * JSONB inside `import_staging_entries.errors`. `code` is the only
 * field consumers should branch on; `message` is human-facing and may
 * be translated later. `field` is optional because some rules are
 * row-level (e.g. unbalanced debit/credit) and don't point at a single
 * column.
 */
export interface ValidationError {
  code: ValidationErrorCode;
  message: string;
  field?: string;
}

/**
 * Closed set of validation rules emitted by `ValidationService`. Kept
 * narrow on purpose so the UI can offer a curated filter ("show only
 * lines with `unknown_account`"); adding a code here is a deliberate
 * product decision, not an ad-hoc string.
 */
export type ValidationErrorCode =
  | 'missing_required_field'
  | 'unknown_account'
  | 'invalid_date'
  | 'date_out_of_fiscal_year'
  | 'invalid_amount'
  | 'debit_credit_both_zero'
  | 'debit_credit_both_nonzero'
  | 'negative_amount';
