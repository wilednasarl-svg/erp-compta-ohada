import { createHash } from 'crypto';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import {
  type DocumentStorage,
  type SaveDocumentInput,
  type SaveDocumentResult,
} from './document-storage.interface';

/**
 * Injection token for the storage root directory. Provided by
 * `DocumentsModule` from `AppConfig.documents.storageDir` so the
 * service stays trivially unit-testable: tests pass a `tmpdir`.
 */
export const DOCUMENT_STORAGE_ROOT = Symbol('DOCUMENT_STORAGE_ROOT');

/**
 * `LocalFilesystemDocumentStorage` — default `DocumentStorage` driver
 * for Module 10 wave 1.
 *
 * Persists bytes under `<root>/<orgId>/<yyyy>/<mm>/<sha256>.<ext>`:
 *   - `orgId` segment isolates tenants on disk (defence-in-depth on
 *     top of the DB-level filter).
 *   - `yyyy/mm` shards 365 days of uploads across 12 directories so
 *     ls / janitor scans stay cheap.
 *   - The basename is the content-addressed SHA-256 hex digest:
 *     two uploads of the same bytes by the same org reuse the same
 *     file on disk. The DB row is still unique per upload (allows
 *     attaching the same scan to several vouchers).
 *   - The extension is derived from the original filename when
 *     recognizable, defaulting to `.bin`. The byte content is the
 *     source of truth — the extension is cosmetic for human ops.
 *
 * SHA-256 is computed on-the-fly while writing so the caller cannot
 * mis-record the checksum. Size is taken from the bytes actually
 * written, not from any header.
 *
 * Idempotency: if the target file already exists (same content
 * uploaded twice), the second `save` is a no-op on disk and returns
 * the same key. `delete` ignores `ENOENT` for the same reason —
 * soft-delete recovery scripts can call it freely.
 *
 * Concurrency: this driver writes to a temp file then atomically
 * renames into place, so two concurrent uploads of the same content
 * cannot leave the target half-written.
 */
@Injectable()
export class LocalFilesystemDocumentStorage implements DocumentStorage {
  private readonly logger = new Logger(LocalFilesystemDocumentStorage.name);

  constructor(@Inject(DOCUMENT_STORAGE_ROOT) private readonly rootDir: string) {}

  async save(input: SaveDocumentInput): Promise<SaveDocumentResult> {
    this.assertOrgIdShape(input.organizationId);

    const ext = this.extensionFor(input.originalName);
    const now = new Date();
    const yyyy = String(now.getUTCFullYear()).padStart(4, '0');
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');

    // Stage to a temp file under the org/year/month directory first,
    // then atomically rename once the final SHA-256 key is known.
    // For Buffer inputs the bytes are already in memory; for Readable
    // streams we tee through createHash so memory stays O(1).
    const stagingDir = path.dirname(
      this.resolveKey(`${input.organizationId}/${yyyy}/${mm}/_placeholder${ext}`),
    );

    try {
      await fs.mkdir(stagingDir, { recursive: true });
      const tmpPath = path.join(
        stagingDir,
        `.upload.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
      );

      const { sha256, sizeBytes } = await this.streamToTempFile(input.body, tmpPath);

      const storageKey = `${input.organizationId}/${yyyy}/${mm}/${sha256}${ext}`;
      const absolute = this.resolveKey(storageKey);

      // Idempotence: if the content-addressed target already exists,
      // drop the temp file and reuse the existing key.
      try {
        const stat = await fs.stat(absolute);
        if (stat.isFile()) {
          await fs.unlink(tmpPath).catch(() => undefined);
          return { storageKey, sha256Checksum: sha256, sizeBytes };
        }
      } catch (statError: unknown) {
        if (!this.isEnoent(statError)) {
          await fs.unlink(tmpPath).catch(() => undefined);
          throw statError;
        }
      }

      await fs.rename(tmpPath, absolute);
      return { storageKey, sha256Checksum: sha256, sizeBytes };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`save: failed to persist document: ${message}`);
      throw new AppException(ERROR_CODES.DOC_STORAGE_FAILURE, {
        message: 'Failed to persist document bytes',
        cause: error,
      });
    }
  }

  async getStream(storageKey: string): Promise<Readable> {
    const absolute = this.resolveKey(storageKey);
    try {
      await fs.access(absolute);
    } catch (error: unknown) {
      if (this.isEnoent(error)) {
        throw new AppException(ERROR_CODES.DOC_NOT_FOUND, {
          message: `Document bytes not found for storageKey='${storageKey}'`,
        });
      }
      throw new AppException(ERROR_CODES.DOC_STORAGE_FAILURE, {
        message: 'Failed to access document bytes',
        cause: error,
      });
    }
    return createReadStream(absolute);
  }

  async delete(storageKey: string): Promise<void> {
    const absolute = this.resolveKey(storageKey);
    try {
      await fs.unlink(absolute);
    } catch (error: unknown) {
      if (this.isEnoent(error)) {
        return;
      }
      throw new AppException(ERROR_CODES.DOC_STORAGE_FAILURE, {
        message: 'Failed to delete document bytes',
        cause: error,
      });
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    const absolute = this.resolveKey(storageKey);
    try {
      await fs.access(absolute);
      return true;
    } catch (error: unknown) {
      if (this.isEnoent(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Resolve a storage key to an absolute path, refusing any key that
   * tries to escape the root via `..` segments. Defence-in-depth: the
   * service should never call us with an attacker-controlled key, but
   * a programming bug must not turn into arbitrary file access.
   */
  private resolveKey(storageKey: string): string {
    const safe = path.normalize(storageKey).replace(/^([/\\])+/, '');
    if (safe.split(/[/\\]/).some((segment) => segment === '..')) {
      throw new AppException(ERROR_CODES.DOC_STORAGE_FAILURE, {
        message: 'Storage key contains path traversal segment',
      });
    }
    const absolute = path.resolve(this.rootDir, safe);
    const rootResolved = path.resolve(this.rootDir);
    if (!absolute.startsWith(rootResolved + path.sep) && absolute !== rootResolved) {
      throw new AppException(ERROR_CODES.DOC_STORAGE_FAILURE, {
        message: 'Storage key resolves outside the storage root',
      });
    }
    return absolute;
  }

  /**
   * Pipe the upload body into `tmpPath` while computing the SHA-256
   * digest and tracking byte count on the fly. Memory stays O(1) for
   * Readable streams (no full-content Buffer accumulation), which is
   * the precondition for the wave-2 S3 driver and large attachments.
   */
  private async streamToTempFile(
    body: Buffer | Readable,
    tmpPath: string,
  ): Promise<{ sha256: string; sizeBytes: number }> {
    const hash = createHash('sha256');
    const source = Buffer.isBuffer(body) ? Readable.from(body) : body;

    let sizeBytes = 0;
    const writeStream = createWriteStream(tmpPath);

    try {
      await pipeline(
        source,
        async function* (src) {
          for await (const chunk of src) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
            hash.update(buf);
            sizeBytes += buf.length;
            yield buf;
          }
        },
        writeStream,
      );
    } catch (error: unknown) {
      await fs.unlink(tmpPath).catch(() => undefined);
      throw error;
    }

    return { sha256: hash.digest('hex'), sizeBytes };
  }

  private extensionFor(originalName: string): string {
    const raw = path.extname(originalName).toLowerCase();
    if (raw.length === 0 || raw.length > 8 || !/^\.[a-z0-9]+$/i.test(raw)) {
      return '.bin';
    }
    return raw;
  }

  private assertOrgIdShape(organizationId: string): void {
    if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
      throw new AppException(ERROR_CODES.DOC_STORAGE_FAILURE, {
        message: 'organizationId is required to persist a document',
      });
    }
    // Reject path-shaped tenant ids defensively (no slashes / dots /
    // null bytes in the segment used as directory name).
    if (/[/\\\0]/.test(organizationId) || organizationId.includes('..')) {
      throw new AppException(ERROR_CODES.DOC_STORAGE_FAILURE, {
        message: 'organizationId contains forbidden characters',
      });
    }
    // Defense-in-depth UUID check (fix projet-ferme-2qn): organizationId
    // is always a UUID coming out of the auth layer. Reject anything
    // else so a programming bug elsewhere can't write into an attacker-
    // controlled directory shape (e.g. ".." stripped above but a 50-char
    // random segment still allowed). Accepts uppercase + lowercase hex.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID.test(organizationId)) {
      throw new AppException(ERROR_CODES.DOC_STORAGE_FAILURE, {
        message: 'organizationId is not a valid UUID',
      });
    }
  }

  private isEnoent(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    );
  }
}
