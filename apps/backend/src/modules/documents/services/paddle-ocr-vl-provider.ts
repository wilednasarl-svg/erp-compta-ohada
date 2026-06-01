import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Injectable, Logger } from '@nestjs/common';

import type { OcrDiagnostics, OcrExtractionResult, OcrProvider } from './ocr-provider';

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

interface PdfToImgModule {
  /** Render a PDF to an async-iterable of per-page PNG buffers. */
  pdf(
    src: string | Buffer,
    options?: { scale?: number; docInitParams?: { standardFontDataUrl?: string } },
  ): Promise<AsyncIterable<Buffer>>;
}

/** Surface minimale de pdfjs-dist nécessaire à l'extraction du calque texte. */
interface PdfjsTextItem {
  readonly str?: string;
}
interface PdfjsTextContent {
  readonly items: ReadonlyArray<PdfjsTextItem>;
}
interface PdfjsPage {
  getTextContent(): Promise<PdfjsTextContent>;
}
interface PdfjsDocument {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfjsPage>;
  destroy(): Promise<void>;
}
interface PdfjsModule {
  getDocument(params: {
    data: Uint8Array;
    isEvalSupported?: boolean;
    standardFontDataUrl?: string;
  }): { promise: Promise<PdfjsDocument> };
}

/**
 * Longueur minimale (caractères hors espaces) du calque texte natif d'un
 * PDF pour le considérer exploitable. En-dessous, on suppose un PDF-scan
 * (image sans texte sélectionnable) et on passe à l'OCR visuel via le Space.
 */
const MIN_PDF_TEXT_LAYER_CHARS = 64;

/** Plafond de pages lues pour le calque texte (les factures tiennent en peu de pages). */
const MAX_TEXT_LAYER_PAGES = 5;

/**
 * Confiance attribuée au texte issu du calque natif : élevée car c'est le
 * texte exact du PDF (aucune erreur de reconnaissance), supérieure à l'OCR.
 */
const PDF_TEXT_LAYER_CONFIDENCE = 0.95;

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
  private pdfModule: PdfToImgModule | false | null = null;
  private pdfjsModule: PdfjsModule | false | null = null;
  // Résolu paresseusement au premier rendu PDF. `undefined` = pas encore
  // tenté ; `null` = résolution impossible (on rasterise alors sans les
  // polices standard). Voir `resolveStandardFontDataUrl`.
  private standardFontDataUrl: string | null | undefined = undefined;
  /** Séquence pour des noms de fichiers temporaires de diagnostic uniques. */
  private diagCounter = 0;

  async extract(filePath: string, mimeType: string): Promise<OcrExtractionResult | null> {
    if (!SUPPORTED_IMAGE_MIMES.has(mimeType) && mimeType !== PDF_MIME) {
      this.logger.debug(`PaddleOcrVlProvider.extract: skipped (unsupported MIME: ${mimeType})`);
      return null;
    }

    // PDF : privilégier le calque texte natif (rapide, local, sans canvas ni
    // appel au Space). Couvre les factures PDF générées électroniquement et
    // contourne tout souci de rasterisation/binding natif. Les PDF-scans (pas
    // de calque texte exploitable) retombent sur l'OCR visuel ci-dessous.
    if (mimeType === PDF_MIME) {
      const layer = await this.extractPdfTextLayer(filePath);
      if (layer !== null && layer.replace(/\s/g, '').length >= MIN_PDF_TEXT_LAYER_CHARS) {
        return { text: layer, confidence: PDF_TEXT_LAYER_CONFIDENCE };
      }
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

    const image = await this.resolveImageBytes(filePath, mimeType);
    if (image === null) {
      return null;
    }

    const client = await gradio.Client.connect(space, connectOptions);
    const root = client.config?.root?.replace(/\/+$/, '') || deriveSpaceHost(space);

    const fileData = await this.uploadImage(root, image.bytes, image.ext, image.mime, hfToken);
    const result = await client.predict(endpoint, [fileData, null, true, false, false]);
    return extractMarkdownFromData(result.data);
  }

  /**
   * Resolve the bytes to send to the Space as an image. Raster images are
   * read as-is; a PDF is rasterised to a PNG of its first page (the Space
   * is image-only). Returns null if a PDF cannot be rasterised (dep absent
   * / render error) — the contract treats that as "OCR skipped".
   */
  private async resolveImageBytes(
    filePath: string,
    mimeType: string,
  ): Promise<{ bytes: Buffer; mime: string; ext: string } | null> {
    if (mimeType === PDF_MIME) {
      return this.rasterisePdfFirstPage(filePath);
    }
    const bytes = await fs.readFile(filePath);
    return { bytes, mime: mimeType, ext: EXTENSION_BY_MIME[mimeType] ?? 'png' };
  }

  /**
   * Rasterise the first page of a PDF to a PNG buffer via the lazily
   * loaded, optional `pdf-to-img` package. `scale: 2` ≈ 144 DPI, a good
   * trade-off for OCR legibility vs upload size. Returns null on any
   * failure (dep missing, unreadable PDF) so the upload path is never
   * bricked.
   */
  private async rasterisePdfFirstPage(
    filePath: string,
  ): Promise<{ bytes: Buffer; mime: string; ext: string } | null> {
    const pdfMod = await this.loadPdfToImg();
    if (pdfMod === false) {
      this.logger.warn('PaddleOcrVlProvider: pdf-to-img not installed — PDF skipped');
      return null;
    }
    try {
      // `standardFontDataUrl` indispensable : sans lui, pdfjs ne charge pas
      // les polices standard (Helvetica/Arial → LiberationSans) et le texte
      // vectoriel des factures PDF n'est PAS rasterisé → page quasi vide →
      // OCR sans contenu. Si la résolution échoue, on rasterise quand même
      // (dégradation gracieuse, utile pour les PDF-scans purement bitmap).
      const fontUrl = this.resolveStandardFontDataUrl();
      const options =
        fontUrl !== null
          ? { scale: 2, docInitParams: { standardFontDataUrl: fontUrl } }
          : { scale: 2 };
      const document = await pdfMod.pdf(filePath, options);
      for await (const page of document) {
        return { bytes: page, mime: 'image/png', ext: 'png' };
      }
      this.logger.warn('PaddleOcrVlProvider: PDF has no pages');
      return null;
    } catch (error: unknown) {
      this.logger.warn(
        `PaddleOcrVlProvider: PDF rasterisation failed (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      return null;
    }
  }

  /**
   * Résout le dossier `standard_fonts/` livré par `pdfjs-dist` (la dépendance
   * de `pdf-to-img`) sous forme d'un chemin filesystem en slashes avant + un
   * slash final — le format exact attendu par pdfjs côté Node.
   *
   * Pourquoi pas un `file://` URL : pdfjs charge les polices via `fetch()`,
   * qui sous Node ne supporte pas le protocole `file://` ; un chemin système
   * en revanche est lu via `fs`. La résolution passe par les `paths` de
   * `pdf-to-img` pour viser la version de `pdfjs-dist` réellement utilisée
   * (et non celle de `pdf-parse`, qui peut différer). Mis en cache : la
   * valeur ne change pas sur la durée de vie du process.
   */
  private resolveStandardFontDataUrl(): string | null {
    if (this.standardFontDataUrl !== undefined) {
      return this.standardFontDataUrl;
    }
    try {
      // `require` est disponible (build CommonJS NestJS) et `require.resolve`
      // localise sans charger — sûr pour le package ESM `pdf-to-img`.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path') as typeof import('path');
      const ptiDir = path.dirname(require.resolve('pdf-to-img'));
      const pjsPkg = require.resolve('pdfjs-dist/package.json', { paths: [ptiDir] });
      const dir = path.join(path.dirname(pjsPkg), 'standard_fonts');
      this.standardFontDataUrl = dir.split(path.sep).join('/') + '/';
    } catch (error: unknown) {
      this.logger.debug(
        `PaddleOcrVlProvider.resolveStandardFontDataUrl: not available (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      this.standardFontDataUrl = null;
    }
    return this.standardFontDataUrl;
  }

  /**
   * Extrait le calque texte natif d'un PDF via `pdfjs-dist` (`getTextContent`).
   * N'effectue AUCUN rendu — donc pas de dépendance à `@napi-rs/canvas` :
   * fonctionne même si le binding natif de rasterisation est cassé. Retourne
   * le texte concaténé (≤ `MAX_TEXT_LAYER_PAGES` pages) ou `null` si le PDF
   * n'a pas de calque texte (scan) ou si pdfjs est indisponible. Jamais throw.
   */
  private async extractPdfTextLayer(filePath: string): Promise<string | null> {
    const pdfjs = await this.loadPdfjs();
    if (pdfjs === false) {
      return null;
    }
    let doc: PdfjsDocument | null = null;
    try {
      const data = new Uint8Array(await fs.readFile(filePath));
      const fontUrl = this.resolveStandardFontDataUrl();
      doc = await pdfjs.getDocument({
        data,
        isEvalSupported: false,
        ...(fontUrl !== null ? { standardFontDataUrl: fontUrl } : {}),
      }).promise;
      const pageCount = Math.min(doc.numPages, MAX_TEXT_LAYER_PAGES);
      const parts: string[] = [];
      for (let n = 1; n <= pageCount; n += 1) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        parts.push(
          content.items.map((item) => (typeof item.str === 'string' ? item.str : '')).join(' '),
        );
      }
      return parts.join('\n').replace(/[ \t]+/g, ' ').trim();
    } catch (error: unknown) {
      this.logger.warn(
        `PaddleOcrVlProvider.extractPdfTextLayer: failed (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      return null;
    } finally {
      if (doc !== null) {
        await doc.destroy().catch(() => undefined);
      }
    }
  }

  /**
   * Charge paresseusement le build ESM Node de `pdfjs-dist`. `pdfjs-dist` est
   * une dépendance transitive (de `pdf-parse` et `pdf-to-img`) : on résout son
   * `legacy/build/pdf.mjs` via les `paths` d'une de ces ancres puis on
   * l'importe par chemin `file://` (un specifier nu échouerait, le paquet
   * n'étant pas une dépendance directe). `false` (caché) si introuvable.
   */
  private async loadPdfjs(): Promise<PdfjsModule | false> {
    if (this.pdfjsModule !== null) {
      return this.pdfjsModule;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path') as typeof import('path');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { pathToFileURL } = require('url') as typeof import('url');
      let pjsPkg: string | null = null;
      for (const anchor of ['pdf-parse', 'pdf-to-img']) {
        try {
          const anchorDir = path.dirname(require.resolve(anchor));
          pjsPkg = require.resolve('pdfjs-dist/package.json', { paths: [anchorDir] });
          break;
        } catch {
          // ancre absente — on tente la suivante.
        }
      }
      if (pjsPkg === null) {
        this.pdfjsModule = false;
        return false;
      }
      const entry = path.join(path.dirname(pjsPkg), 'legacy', 'build', 'pdf.mjs');
      const importDynamic = new Function('specifier', 'return import(specifier)') as (
        specifier: string,
      ) => Promise<unknown>;
      this.pdfjsModule = (await importDynamic(pathToFileURL(entry).href)) as PdfjsModule;
      return this.pdfjsModule;
    } catch (error: unknown) {
      this.logger.debug(
        `PaddleOcrVlProvider.loadPdfjs: not available (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      this.pdfjsModule = false;
      return false;
    }
  }

  /**
   * Self-test (jamais throw) : vérifie les dépendances optionnelles et
   * tente une rasterisation d'un PDF synthétique. Permet de savoir, en
   * prod, POURQUOI un PDF est passé en « OCR ignoré » sans accès aux logs.
   */
  async diagnose(): Promise<OcrDiagnostics> {
    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

    const gradio = await this.loadGradioClient();
    checks.push({
      name: '@gradio/client',
      ok: gradio !== false,
      detail: gradio === false ? 'module absent (optionalDependency non installée)' : 'chargé',
    });

    const pdfMod = await this.loadPdfToImg();
    checks.push({
      name: 'pdf-to-img',
      ok: pdfMod !== false,
      detail: pdfMod === false ? 'module absent (rasterisation PDF impossible)' : 'chargé',
    });

    const fontUrl = this.resolveStandardFontDataUrl();
    checks.push({
      name: 'pdfjs standard_fonts',
      ok: fontUrl !== null,
      detail: fontUrl ?? 'non résolu (texte vectoriel non rendu)',
    });

    if (pdfMod !== false) {
      let tmpPath: string | null = null;
      try {
        tmpPath = join(tmpdir(), `ocr-diag-${process.pid}-${this.diagSeq()}.pdf`);
        await fs.writeFile(tmpPath, buildDiagnosticPdf());
        const raster = await this.rasterisePdfFirstPage(tmpPath);
        checks.push({
          name: 'rasterisation PDF (test)',
          ok: raster !== null,
          detail:
            raster !== null
              ? `OK — ${raster.bytes.length} octets PNG`
              : 'rasterisePdfFirstPage a renvoyé null (voir logs PDF rasterisation failed)',
        });
      } catch (error: unknown) {
        checks.push({
          name: 'rasterisation PDF (test)',
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (tmpPath !== null) {
          await fs.unlink(tmpPath).catch(() => undefined);
        }
      }
    }

    return { engine: process.env.OCR_ENGINE?.trim() || '(défaut/legacy)', checks };
  }

  /** Compteur monotone pour des noms de fichiers temporaires uniques sans Date.now(). */
  private diagSeq(): number {
    this.diagCounter += 1;
    return this.diagCounter;
  }

  /**
   * Upload the image bytes to the Space and return the Gradio `FileData`
   * pointing at the stored file. The filename carries the real extension
   * so the Space's `file_types=['image']` check passes.
   */
  private async uploadImage(
    root: string,
    bytes: Buffer,
    ext: string,
    mimeType: string,
    hfToken: string | undefined,
  ): Promise<Record<string, unknown>> {
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

  /** Lazy dynamic-import of the optional ESM `pdf-to-img` package. */
  protected async loadPdfToImg(): Promise<PdfToImgModule | false> {
    if (this.pdfModule !== null) {
      return this.pdfModule;
    }
    try {
      const importDynamic = new Function('specifier', 'return import(specifier)') as (
        specifier: string,
      ) => Promise<unknown>;
      const mod = (await importDynamic('pdf-to-img')) as PdfToImgModule;
      this.pdfModule = mod;
      return mod;
    } catch (error: unknown) {
      this.logger.debug(
        `PaddleOcrVlProvider.loadPdfToImg: not available (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      this.pdfModule = false;
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

/**
 * Construit un PDF 1.4 minimal valide (une page, un peu de texte vectoriel)
 * pour le self-test de rasterisation. Sans dépendance : bytes bruts + table
 * xref correcte, ce que pdfjs/pdf-to-img sait rendre.
 */
function buildDiagnosticPdf(): Buffer {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length 58 >>\nstream\nBT /F1 18 Tf 30 120 Td (OCR DIAGNOSTIC) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => {
    pdf += String(o).padStart(10, '0') + ' 00000 n \n';
  });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
