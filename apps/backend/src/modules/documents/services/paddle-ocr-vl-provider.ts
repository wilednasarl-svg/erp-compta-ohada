import { promises as fs } from 'fs';

import { Injectable, Logger } from '@nestjs/common';

import type { OcrExtractionResult, OcrProvider } from './ocr-provider';

/**
 * `PaddleOcrVlProvider` — `OcrProvider` backed by the open-source
 * **PaddleOCR-VL-1.6** vision-language model (Apache 2.0), invoked
 * through a HuggingFace Gradio Space rather than hosted in-process.
 *
 * Why a Space and not a local model
 * ---------------------------------
 * PaddleOCR-VL is a ~1 B-param VLM that needs a GPU. The backend runs
 * on Railway (CPU-only), so the model lives behind an HTTP boundary.
 * We call the official demo Space (or, recommended, your own private
 * duplicate of it) which runs on HF **ZeroGPU** — free, GPU-backed,
 * zero infra to operate. The only cost is the ZeroGPU rate limit
 * (~300 s/day for programmatic access), which caps throughput to a few
 * dozen invoices/day. Past that, point `PADDLE_OCR_SPACE` at a paid
 * Inference Endpoint with the same Gradio surface — no code change.
 *
 * File upload
 * -----------
 * The Space's file component is a `gr.File(file_types=['image'])`. A raw
 * Blob passed positionally is rejected ("Invalid file type") because the
 * type check runs on the uploaded file's name/extension. So we upload
 * the bytes ourselves to the Space's `/gradio_api/upload` endpoint with a
 * proper `facture.<ext>` filename, then pass the returned server path as
 * a Gradio `FileData` object. This was validated end-to-end against a
 * real Ivorian invoice.
 *
 * Behaviour
 * ---------
 *   - Lazy-loads `@gradio/client` on first call (kept out of the static
 *     graph and in `optionalDependencies`, exactly like `tesseract.js`,
 *     so the build and non-Paddle tests pass when the dep is absent).
 *   - Supports raster images. PDF is declined (returns null →
 *     `ocr_status='skipped'`): the demo Space expects an image, and
 *     rasterising a PDF page is a separate follow-up.
 *   - Bounds each run with a timeout; on timeout / engine error /
 *     missing dep it returns `null` — it MUST NOT throw (contract).
 *
 * Output
 * ------
 * The Space's `parse_doc` endpoint returns the document as **Markdown**
 * (tables — rendered as HTML — amounts and layout preserved far better
 * than Tesseract's flat text). That Markdown flows into the existing
 * `extractInvoiceMetadata(...)` step, which lifts the structured invoice
 * fields (supplier, n°, date, HT/TVA/TTC) downstream.
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

/** Default public demo Space. Override with `PADDLE_OCR_SPACE`. */
const DEFAULT_SPACE = 'PaddlePaddle/PaddleOCR-VL-1.6_Online_Demo';

/** Gradio endpoint exposed by the demo's `parse_doc` handler. */
const DEFAULT_ENDPOINT = '/parse_doc';

/** Hard time-budget for a single OCR round-trip (Space cold-start + GPU). */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Confidence is a heuristic: the Space returns Markdown with no
 * per-token score. We report a fixed high value for a non-empty result
 * (PaddleOCR-VL is a strong recogniser) and 0 for an empty one.
 * Consumers must not over-interpret this number.
 */
const NONEMPTY_CONFIDENCE = 0.85;

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/tiff': 'tiff',
  'image/bmp': 'bmp',
};

interface GradioPredictResult {
  readonly data?: unknown;
}

interface GradioClient {
  predict(endpoint: string, payload: unknown): Promise<GradioPredictResult>;
  /** Resolved Space config; `root` is the base URL used for uploads. */
  config?: { root?: string };
}

interface GradioClientModule {
  Client: {
    connect(space: string, options?: Record<string, unknown>): Promise<GradioClient>;
  };
}

/**
 * Coerce the `parse_doc` output array `[md_preview, vis_html, md_raw]`
 * into the raw Markdown string. Prefer the raw Markdown (index 2); fall
 * back to the preview (index 0). Each element may be a plain string or a
 * `{ value }` wrapper depending on the Gradio component / version.
 * Exported for unit testing (pure, no I/O).
 */
export function extractMarkdownFromData(data: unknown): string | null {
  if (!Array.isArray(data)) return null;
  return coerceToString(data[2]) ?? coerceToString(data[0]);
}

function coerceToString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value: unknown }).value;
    if (typeof inner === 'string') return inner;
  }
  return null;
}

@Injectable()
export class PaddleOcrVlProvider implements OcrProvider {
  private readonly logger = new Logger(PaddleOcrVlProvider.name);

  // Lazy-loaded module reference. `null` until first successful load;
  // `false` once a load attempt failed (dep absent) so we don't retry
  // the import on every call.
  private gradioModule: GradioClientModule | false | null = null;

  async extract(filePath: string, mimeType: string): Promise<OcrExtractionResult | null> {
    if (!SUPPORTED_IMAGE_MIMES.has(mimeType)) {
      if (mimeType === PDF_MIME) {
        this.logger.debug(
          'PaddleOcrVlProvider.extract: PDF declined (image-only demo Space) — TODO rasterise',
        );
      } else {
        this.logger.debug(`PaddleOcrVlProvider.extract: skipped (unsupported MIME: ${mimeType})`);
      }
      return null;
    }

    const timeoutMs = this.resolveTimeoutMs();
    try {
      const text = await this.withTimeout(this.fetchMarkdown(filePath, mimeType), timeoutMs, 'parse_doc');
      if (text === null) {
        return null;
      }
      const trimmed = text.trim();
      return { text: trimmed, confidence: trimmed.length > 0 ? NONEMPTY_CONFIDENCE : 0 };
    } catch (error: unknown) {
      this.logger.warn(
        `PaddleOcrVlProvider.extract: failed (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      return null;
    }
  }

  /**
   * Connect to the Space, upload the image, call `parse_doc`, and return
   * the raw Markdown (or null if the dep is missing / output malformed).
   * `protected` so unit tests can stub the whole network round-trip and
   * exercise `extract`'s contract logic in isolation.
   */
  protected async fetchMarkdown(filePath: string, mimeType: string): Promise<string | null> {
    const gradio = await this.loadGradioClient();
    if (gradio === false) {
      this.logger.warn('PaddleOcrVlProvider: @gradio/client not installed; returning null');
      return null;
    }

    const space = process.env.PADDLE_OCR_SPACE?.trim() || DEFAULT_SPACE;
    const endpoint = process.env.PADDLE_OCR_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
    const hfToken = process.env.HF_TOKEN?.trim();

    const connectOptions: Record<string, unknown> = {};
    if (hfToken !== undefined && hfToken.length > 0) {
      connectOptions.hf_token = hfToken;
    }

    const client = await gradio.Client.connect(space, connectOptions);
    const root = client.config?.root?.replace(/\/+$/, '') || deriveSpaceHost(space);

    const fileData = await this.uploadImage(root, filePath, mimeType, hfToken);
    const result = await client.predict(endpoint, [fileData, null, true, false, false]);
    return extractMarkdownFromData(result.data);
  }

  /**
   * Upload the image bytes to the Space and return the Gradio `FileData`
   * pointing at the stored file. The filename carries the real extension
   * so the Space's `file_types=['image']` check passes.
   */
  private async uploadImage(
    root: string,
    filePath: string,
    mimeType: string,
    hfToken: string | undefined,
  ): Promise<Record<string, unknown>> {
    const bytes = await fs.readFile(filePath);
    const ext = EXTENSION_BY_MIME[mimeType] ?? 'png';
    const file = new File([new Uint8Array(bytes)], `facture.${ext}`, { type: mimeType });

    const form = new FormData();
    form.append('files', file);

    const headers: Record<string, string> = {};
    if (hfToken !== undefined && hfToken.length > 0) {
      headers.Authorization = `Bearer ${hfToken}`;
    }

    const response = await fetch(`${root}/gradio_api/upload`, {
      method: 'POST',
      headers,
      body: form,
    });
    if (!response.ok) {
      throw new Error(`upload failed: HTTP ${response.status}`);
    }
    const serverPaths = (await response.json()) as unknown;
    if (!Array.isArray(serverPaths) || typeof serverPaths[0] !== 'string') {
      throw new Error('upload returned an unexpected payload');
    }
    const serverPath = serverPaths[0];

    return {
      path: serverPath,
      url: `${root}/gradio_api/file=${serverPath}`,
      orig_name: `facture.${ext}`,
      mime_type: mimeType,
      meta: { _type: 'gradio.FileData' },
    };
  }

  private resolveTimeoutMs(): number {
    const raw = process.env.PADDLE_OCR_TIMEOUT_MS?.trim();
    if (raw === undefined || raw.length === 0) return DEFAULT_TIMEOUT_MS;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  }

  /**
   * Lazy dynamic-import of `@gradio/client` (an ESM-only package). The
   * `new Function` indirection preserves a real `import()` through the
   * CommonJS/ts-jest transpile so Node loads the ESM module natively.
   * Returns `false` (cached) if the dep is absent. Marked `protected`
   * so tests can override it with a fake client.
   */
  protected async loadGradioClient(): Promise<GradioClientModule | false> {
    if (this.gradioModule !== null) {
      return this.gradioModule;
    }
    try {
      const importDynamic = new Function('specifier', 'return import(specifier)') as (
        specifier: string,
      ) => Promise<unknown>;
      const mod = (await importDynamic('@gradio/client')) as GradioClientModule;
      this.gradioModule = mod;
      return mod;
    } catch (error: unknown) {
      this.logger.debug(
        `PaddleOcrVlProvider.loadGradioClient: not available (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      this.gradioModule = false;
      return false;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`paddle-ocr.${label} timed out after ${ms}ms`));
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

/**
 * Derive a Space's default `*.hf.space` host from its `owner/name` id
 * (lowercase, every non-alphanumeric run becomes a single hyphen). Used
 * as a fallback when the connected client does not expose `config.root`.
 */
function deriveSpaceHost(space: string): string {
  const slug = space.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '');
  return `https://${slug}.hf.space`;
}
