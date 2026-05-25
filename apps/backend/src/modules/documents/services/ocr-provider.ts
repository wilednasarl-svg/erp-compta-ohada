/**
 * `OcrProvider` — abstract contract for the OCR engine used by Module
 * 10 wave 2.
 *
 * The contract is intentionally narrow: implementations receive the
 * absolute path to a local file on disk and the declared MIME type,
 * and return either the extracted text + confidence or `null` if the
 * file cannot be processed (unsupported MIME, engine failure, timeout).
 *
 * Returning `null` is NOT an error — `DocumentsService` treats it as
 * "OCR not applicable" and leaves `ocr_status='skipped'` / the OCR
 * columns NULL. Hard failures (the engine threw) MUST be caught by
 * the implementation and converted to `null` so the upload path is
 * never bricked by OCR.
 *
 * Wave 2 ships two implementations:
 *   - `TesseractOcrProvider` — real OCR via tesseract.js (lazy-loaded).
 *   - `NullOcrProvider`      — always returns null; used when
 *                              `OCR_ENABLED` is not set.
 */
export interface OcrExtractionResult {
  /**
   * Raw extracted text. Empty string is a valid result (a blank page);
   * `null` from `extract` means "did not run".
   */
  readonly text: string;

  /**
   * Average confidence in [0, 1] across the recognized tokens.
   * Provider-defined heuristic; consumers should not over-interpret
   * fine-grained differences.
   */
  readonly confidence: number;
}

export interface OcrProvider {
  /**
   * Extract text from a local file. Returns `null` if the file cannot
   * be processed (unsupported MIME, engine error, timeout). MUST NOT
   * throw — wrap engine failures in a try/catch and return null.
   */
  extract(filePath: string, mimeType: string): Promise<OcrExtractionResult | null>;
}

/**
 * Injection token for `OcrProvider`. Bound in `DocumentsModule` via
 * `useFactory` to either Tesseract or Null depending on `OCR_ENABLED`.
 */
export const OCR_PROVIDER = Symbol('OCR_PROVIDER');
