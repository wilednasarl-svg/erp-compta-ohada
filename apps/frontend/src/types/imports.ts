/**
 * Types miroir du module backend `imports`. Ces shapes correspondent
 * EXACTEMENT à ce que les endpoints REST renvoient — un changement
 * côté backend doit être répercuté ici pour que le compilateur
 * surface les call-sites cassés.
 *
 * Référence backend :
 *   - apps/backend/src/modules/imports/types/import-status.ts
 *   - apps/backend/src/modules/imports/services/import-session.service.ts
 */

export type ImportSourceType = 'csv' | 'excel' | 'sage' | 'txt' | 'pdf';

export type ImportSessionStatus =
  | 'draft'
  | 'parsing'
  | 'parsed'
  | 'validated'
  | 'ready_for_import'
  | 'completed'
  | 'failed';

export type TargetField =
  | 'account'
  | 'journal'
  | 'date'
  | 'debit'
  | 'credit'
  | 'label'
  | 'partner'
  | 'currency';

export type ValidationErrorCode =
  | 'missing_required_field'
  | 'unknown_account'
  | 'invalid_date'
  | 'date_out_of_fiscal_year'
  | 'invalid_amount'
  | 'debit_credit_both_zero'
  | 'debit_credit_both_nonzero'
  | 'negative_amount';

export interface ValidationError {
  readonly code: ValidationErrorCode;
  readonly message: string;
  readonly field?: string;
}

export interface SessionSummary {
  readonly id: string;
  readonly status: ImportSessionStatus;
  readonly sourceType: ImportSourceType;
  readonly label: string | null;
  readonly totalLines: number;
  readonly errorLines: number;
  readonly createdAt: string;
}

export type MappedRow = Partial<Record<TargetField, string | null>>;

export interface PreviewEntry {
  readonly rowNumber: number;
  readonly rawValues: Record<string, string | null>;
  readonly mappedValues: MappedRow;
  readonly errors: ReadonlyArray<ValidationError>;
}

export interface PreviewResult {
  readonly session: SessionSummary;
  readonly headers: ReadonlyArray<string>;
  readonly headerMapping: Record<string, TargetField>;
  readonly unmappedTargets: ReadonlyArray<TargetField>;
  readonly totals: { total: number; withErrors: number };
  readonly entries: ReadonlyArray<PreviewEntry>;
}

export interface CommitResult {
  readonly sessionId: string;
  readonly committedRows: number;
}
