/**
 * Coarse-grained document category derived from the `documents.mime_type`
 * column. Unlike the `mimeType` filter (an exact match), `category`
 * groups related MIME types into a small, UI-friendly enumeration so the
 * Documents list can offer a "type of file" facet without the caller
 * having to enumerate every spreadsheet/word-processor MIME string.
 *
 * Kept as a string-literal union (greppable, no implicit numeric values).
 * The MIME -> category mapping itself lives in the repository
 * (`listForOrg`) so the SQL stays the single source of truth for which
 * exact MIME types fall into each bucket.
 *
 *   - `pdf`         : application/pdf
 *   - `image`       : image/* (png, jpeg, webp, tiff, …)
 *   - `spreadsheet` : csv / xls / xlsx / ods
 *   - `document`    : doc / docx / odt / plain text
 *   - `other`       : anything not matched by the buckets above
 */
export type DocumentCategory = 'pdf' | 'image' | 'spreadsheet' | 'document' | 'other';

export const DOCUMENT_CATEGORY_VALUES: ReadonlyArray<DocumentCategory> = [
  'pdf',
  'image',
  'spreadsheet',
  'document',
  'other',
];

/**
 * Exact MIME types that constitute the `spreadsheet` category. Shared by
 * the repository SQL builder so the `spreadsheet` and `other` (negation)
 * clauses stay in lock-step.
 */
export const SPREADSHEET_MIME_TYPES: ReadonlyArray<string> = [
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
];

/**
 * Exact MIME types that constitute the `document` category.
 */
export const DOCUMENT_MIME_TYPES: ReadonlyArray<string> = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'text/plain',
];
