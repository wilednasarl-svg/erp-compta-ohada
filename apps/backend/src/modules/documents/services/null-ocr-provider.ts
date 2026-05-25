import { Injectable, Logger } from '@nestjs/common';

import type { OcrExtractionResult, OcrProvider } from './ocr-provider';

/**
 * `NullOcrProvider` — no-op `OcrProvider` used when the OCR engine is
 * not enabled (`OCR_ENABLED` env var unset / false).
 *
 * Always returns `null`. The Document upload path treats `null` as
 * "OCR not applicable" and leaves the OCR columns NULL, with
 * `ocr_status='skipped'`.
 */
@Injectable()
export class NullOcrProvider implements OcrProvider {
  private readonly logger = new Logger(NullOcrProvider.name);

  async extract(_filePath: string, mimeType: string): Promise<OcrExtractionResult | null> {
    this.logger.debug(`NullOcrProvider.extract: skipped (OCR disabled) mime=${mimeType}`);
    return null;
  }
}
