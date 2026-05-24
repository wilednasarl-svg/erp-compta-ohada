import type { Readable } from 'stream';

/**
 * `DocumentStorage` — abstract contract for the physical bytes store
 * backing the Document Engine.
 *
 * Module 10 wave 1 ships a local-filesystem implementation
 * (`LocalFilesystemDocumentStorage`). A future wave will add an
 * S3 / Supabase Storage driver implementing the same contract — the
 * `storageKey` shape is intentionally opaque so each driver can pick
 * its own scheme without leaking implementation details to the service
 * or the database.
 *
 * Contract
 * --------
 *   - `save` writes the bytes and returns the storage key + content
 *     descriptors needed by `DocumentsService` to persist the row.
 *     The driver MUST compute the SHA-256 checksum and total size
 *     while streaming so callers cannot mis-record them. The driver
 *     SHOULD use a content-addressed key so an accidental
 *     intra-driver collision is impossible.
 *   - `getStream` returns a Node.js `Readable` of the stored bytes
 *     ready to be piped to the HTTP response. Throws if the key does
 *     not exist — callers MUST translate that into a 404 at the
 *     controller boundary.
 *   - `delete` is idempotent: deleting a non-existent key is a no-op.
 *     This keeps the soft-delete path safe against partial-write
 *     scenarios where the row was committed but the bytes were never
 *     persisted.
 *   - `exists` is a cheap probe used by maintenance scripts and
 *     dedup logic.
 *
 * All methods are async. Drivers MUST NOT throw synchronously — every
 * I/O failure surfaces as a rejected promise so the service can wrap
 * it in `DOC_STORAGE_FAILURE`.
 */
export interface SaveDocumentInput {
  /**
   * The organization that owns the document. The driver uses it to
   * scope the storage key (e.g. local FS: directory per org; S3:
   * prefix per org). Multi-tenant isolation at the bytes layer.
   */
  readonly organizationId: string;

  /**
   * Original filename as uploaded by the user. The driver uses the
   * extension only — to keep the storage key human-recognizable.
   * The display filename lives on the `documents` row.
   */
  readonly originalName: string;

  /**
   * MIME type as declared by the upload (Content-Type). Persisted on
   * the row for downstream rendering decisions; not validated here
   * (that's the service's responsibility against an allow-list).
   */
  readonly mimeType: string;

  /**
   * The bytes to persist. Wave 1 uses an in-memory `Buffer` — the
   * MVP cap is 50 MB so buffering is fine. The contract accepts a
   * `Readable` too so the wave-2 S3 driver can stream-upload large
   * files without buffering.
   */
  readonly body: Buffer | Readable;
}

export interface SaveDocumentResult {
  /**
   * Opaque locator returned by the driver. Persisted as
   * `documents.storage_key` and passed back to `getStream` / `delete`.
   */
  readonly storageKey: string;

  /**
   * SHA-256 hash of the persisted bytes, hex-encoded lowercase, 64
   * chars. The DB CHECK constraint enforces the shape.
   */
  readonly sha256Checksum: string;

  /**
   * Total bytes written. Persisted as `documents.size_bytes`. Drivers
   * MUST compute this from the actual writes, not from the
   * `Content-Length` header (which can lie under chunked uploads).
   */
  readonly sizeBytes: number;
}

export interface DocumentStorage {
  save(input: SaveDocumentInput): Promise<SaveDocumentResult>;
  getStream(storageKey: string): Promise<Readable>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
}

/**
 * Injection token for the abstract storage. Modules consume it via
 * `@Inject(DOCUMENT_STORAGE)` — concrete driver wiring lives in
 * `DocumentsModule.providers` so swapping the implementation (local-FS
 * → S3) is a one-line change.
 */
export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');
