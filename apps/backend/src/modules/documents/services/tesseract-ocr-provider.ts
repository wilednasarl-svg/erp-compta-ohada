import { Injectable, Logger } from '@nestjs/common';

import type { OcrExtractionResult, OcrProvider } from './ocr-provider';

/**
 * MIME types Tesseract can OCR directly (raster images). For PDF the
 * provider attempts to OCR the file as-is; wave 2 explicitly accepts
 * that only the first page is processed (full PDF OCR is wave 3 and
 * requires a rasterizer like `pdf-to-img` or `pdf-poppler`).
 */
const SUPPORTED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/tiff',
  'image/bmp',
]);

const PDF_MIME = 'application/pdf';

/**
 * Hard time-budget for a single OCR run. Tesseract.js worker init +
 * recognize can hang on degenerate inputs; we abort after this delay
 * and return null so the upload path is never blocked.
 */
const OCR_TIMEOUT_MS = 30_000;

/**
 * `TesseractOcrProvider` — real `OcrProvider` backed by tesseract.js.
 *
 * Behaviour
 * ---------
 *   - Lazy-loads `tesseract.js` on first call (so test environments
 *     without the dep installed still compile and run the
 *     non-tesseract tests).
 *   - Spins up a worker per call and terminates it immediately after
 *     — wave 2 prioritises memory-bounded behaviour over throughput.
 *     A wave-3 enhancement could pool workers.
 *   - Bounds each run with a 30 s timeout. Past the deadline the
 *     worker is force-terminated and `null` is returned.
 *   - Catches every engine error and returns `null` so the upload
 *     path is never bricked by OCR.
 *
 * Known limitations (documented for wave 3)
 * -----------------------------------------
 *   - PDF: only the first page is processed in wave 2 (TODO wave 3).
 *   - Language: defaults to `fra+eng` (French invoices are the primary
 *     use case, English fallback covers anglo suppliers).
 *   - No MRZ / barcode extraction for IDs (out of scope for wave 2).
 */
@Injectable()
export class TesseractOcrProvider implements OcrProvider {
  private readonly logger = new Logger(TesseractOcrProvider.name);

  // Lazy-loaded module reference. `unknown` keeps the type-graph free
  // of a hard dependency on tesseract.js — if the package isn't
  // installed locally, this provider just keeps returning null at
  // runtime without failing the type-check.
  private tesseractModule: unknown = null;

  async extract(filePath: string, mimeType: string): Promise<OcrExtractionResult | null> {
    if (!this.isSupportedMime(mimeType)) {
      this.logger.debug(`TesseractOcrProvider.extract: skipped (unsupported MIME: ${mimeType})`);
      return null;
    }

    const tesseract = await this.loadTesseractModule();
    if (tesseract === null) {
      this.logger.warn('TesseractOcrProvider.extract: tesseract.js not installed; returning null');
      return null;
    }

    if (mimeType === PDF_MIME) {
      this.logger.debug(
        `TesseractOcrProvider.extract: PDF wave-2 limitation — first page only (TODO wave 3)`,
      );
    }

    let worker: unknown = null;
    try {
      worker = await this.withTimeout(
        (tesseract as { createWorker: (lang: string) => Promise<unknown> }).createWorker('fra+eng'),
        OCR_TIMEOUT_MS,
        'createWorker',
      );

      const recognizeResult = await this.withTimeout(
        (worker as { recognize: (input: string) => Promise<unknown> }).recognize(filePath),
        OCR_TIMEOUT_MS,
        'recognize',
      );

      const data = (recognizeResult as { data?: { text?: string; confidence?: number } }).data;
      if (data === undefined || typeof data.text !== 'string') {
        this.logger.warn('TesseractOcrProvider.extract: empty/invalid recognize() output');
        return null;
      }

      const text = data.text.trim();
      const rawConfidence = typeof data.confidence === 'number' ? data.confidence : 0;
      // tesseract.js reports confidence in [0, 100]; normalize to [0, 1].
      const confidence = Math.max(0, Math.min(1, rawConfidence / 100));

      return { text, confidence };
    } catch (error: unknown) {
      this.logger.warn(
        `TesseractOcrProvider.extract: failed (${error instanceof Error ? error.message : String(error)})`,
      );
      return null;
    } finally {
      if (worker !== null) {
        try {
          await (worker as { terminate: () => Promise<void> }).terminate();
        } catch (terminateError: unknown) {
          this.logger.warn(
            `TesseractOcrProvider.extract: worker.terminate() failed: ${
              terminateError instanceof Error ? terminateError.message : String(terminateError)
            }`,
          );
        }
      }
    }
  }

  private isSupportedMime(mimeType: string): boolean {
    return SUPPORTED_IMAGE_MIMES.has(mimeType) || mimeType === PDF_MIME;
  }

  /**
   * Lazy `require` of tesseract.js. Returns null if the package is
   * not installed so the type-check + non-tesseract tests pass on
   * environments without the dep.
   */
  private async loadTesseractModule(): Promise<unknown> {
    if (this.tesseractModule !== null) {
      return this.tesseractModule;
    }
    try {
      // Indirect import keeps `tesseract.js` out of the static graph
      // so the build does not fail when the package is absent.
      const moduleName = 'tesseract.js';
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      this.tesseractModule = require(moduleName) as unknown;
      return this.tesseractModule;
    } catch (error: unknown) {
      this.logger.debug(
        `TesseractOcrProvider.loadTesseractModule: not available (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      return null;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`tesseract.${label} timed out after ${ms}ms`));
      }, ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  }
}
