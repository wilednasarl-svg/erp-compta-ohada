/**
 * Stable enumeration of OCR lifecycle states stored on the `documents.ocr_status`
 * column. Kept as a string-literal union so the wire format is the
 * literal (greppable, no implicit numeric values) and the DB CHECK
 * constraint (`0020_create_documents.ts`) stays the single source of
 * truth at the schema layer.
 *
 *   - `pending`    : freshly uploaded, queued for OCR (default).
 *   - `processing` : an OCR worker has picked the row and is running.
 *   - `processed`  : OCR completed, `ocr_text` is populated.
 *   - `failed`     : worker gave up (corrupted file, format unsupported).
 *     Eligible for manual retry through a future endpoint.
 *   - `skipped`    : OCR intentionally bypassed for this document
 *     (binary type that has no extractable text, admin opt-out, etc).
 */
export type OcrStatus = 'pending' | 'processing' | 'processed' | 'failed' | 'skipped';

export const OCR_STATUS_VALUES: ReadonlyArray<OcrStatus> = [
  'pending',
  'processing',
  'processed',
  'failed',
  'skipped',
];
