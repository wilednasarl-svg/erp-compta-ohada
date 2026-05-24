import { createHash } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import path from 'path';
import { Readable } from 'stream';

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

    const { sha256, sizeBytes, bytes } = await this.hashBody(input.body);
    const ext = this.extensionFor(input.originalName);
    const now = new Date();
    const yyyy = String(now.getUTCFullYear()).padStart(4, '0');
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');

    const storageKey = `${input.organizationId}/${yyyy}/${mm}/${sha256}${ext}`;
    const absolute = this.resolveKey(storageKey);
    const dir = path.dirname(absolute);

    try {
      await fs.mkdir(dir, { recursive: true });

      // Skip write when the content-addressed target already exists —
      // re-uploads of identical bytes converge to the same key.
      try {
        const stat = await fs.stat(absolute);
        if (stat.isFile()) {
          return { storageKey, sha256Checksum: sha256, sizeBytes };
        }
      } catch (statError: unknown) {
        if (!this.isEnoent(statError)) {
          throw statError;
        }
      }

      // Atomic write: temp file in the same directory + rename, so a
      // crash mid-write never leaves a half-written final file.
      const tmpPath = `${absolute}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmpPath, bytes);
      await fs.rename(tmpPath, absolute);

      return { storageKey, sha256Checksum: sha256, sizeBytes };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`save: failed to persist storageKey='${storageKey}': ${message}`);
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

  private async hashBody(
    body: Buffer | Readable,
  ): Promise<{ sha256: string; sizeBytes: number; bytes: Buffer }> {
    const hash = createHash('sha256');
    if (Buffer.isBuffer(body)) {
      hash.update(body);
      return { sha256: hash.digest('hex'), sizeBytes: body.length, bytes: body };
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      chunks.push(buf);
      size += buf.length;
      hash.update(buf);
    }
    return { sha256: hash.digest('hex'), sizeBytes: size, bytes: Buffer.concat(chunks, size) };
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
