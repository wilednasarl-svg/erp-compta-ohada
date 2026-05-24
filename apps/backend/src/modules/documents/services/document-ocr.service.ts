import { Injectable, Logger } from '@nestjs/common';

/**
 * `DocumentOcrService` — vague 1 stub.
 *
 * Wave 1 ships the OCR HOOK only, not the engine. `requestOcr` is
 * called by `DocumentsService.createFromUpload` right after the row
 * is persisted; today it only logs and returns. The document stays
 * `ocr_status='pending'`.
 *
 * Wave 2 will replace this stub with one of:
 *   - a synchronous in-process worker for small text-only PDFs,
 *   - a queue producer (BullMQ / Redis) feeding an out-of-band
 *     worker for image / scanned PDF OCR,
 *   - a fan-out to a managed OCR service.
 *
 * The public surface (`requestOcr(documentId): Promise<void>`) is
 * deliberately narrow so any of those implementations can swap in
 * without touching the upload path. The contract is fire-and-forget:
 * a failure to enqueue MUST NOT brick the upload (the document is
 * still usable; OCR is a best-effort enrichment).
 */
@Injectable()
export class DocumentOcrService {
  private readonly logger = new Logger(DocumentOcrService.name);

  requestOcr(documentId: string, organizationId: string): Promise<void> {
    // TODO(Module 10 wave 2) — enqueue an OCR job for `documentId`.
    // Current behaviour: log at INFO and return; the row remains
    // `ocr_status='pending'` until a real worker promotes it. The
    // signature stays `Promise<void>` so a future async implementation
    // (queue producer, HTTP fan-out) can swap in without touching the
    // call sites in `DocumentsService`.
    this.logger.log(
      `requestOcr: document ${documentId} (org ${organizationId}) queued (stub — no engine wired)`,
    );
    return Promise.resolve();
  }
}
