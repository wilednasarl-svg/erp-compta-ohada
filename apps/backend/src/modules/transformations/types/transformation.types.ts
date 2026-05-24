/**
 * Canonical types for the Transformation Engine (Module 4, wave 1).
 *
 * A transformation is a record of INTENT applied to a source entry
 * (import_staging_entries). The source entry is NEVER mutated. The
 * effective state of an entry is its raw_values + the chain of active
 * transformations applied to it.
 *
 * Invariants:
 *  - source entry stays immutable (raw_values untouched).
 *  - status 'cancelled' marks a soft-deleted transformation (undo-ready).
 *  - before_values + after_values capture the diff, not the full row,
 *    so the audit view stays readable.
 */

export type TransformationType =
  | 'reclassification' // change account / journal / analytic
  | 'adjustment' // add a correcting amount entry linked to the source
  | 'correction' // fix a label, date, reference, or partner
  | 'ventilation' // split one entry across multiple accounts
  | 'grouping'; // merge several entries into one (recorded as annotation)

export type TransformationStatus = 'active' | 'cancelled';

/**
 * The subset of mapped_values fields that can be targeted by a
 * reclassification.
 */
export type ReclassifiableField = 'account' | 'journal' | 'partner' | 'label';

/**
 * Shape stored in `before_values` and `after_values` JSONB columns.
 * Sparse by design — only the changed fields are recorded.
 */
export type TransformationDiff = Partial<Record<ReclassifiableField, string | null>> & {
  /** For adjustment type: the amount added (positive = debit, negative = credit). */
  adjustmentDebit?: string | null;
  adjustmentCredit?: string | null;
  adjustmentLabel?: string | null;
};
