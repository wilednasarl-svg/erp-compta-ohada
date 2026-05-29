import { createHash } from 'crypto';
import path from 'path';
import { Readable } from 'stream';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import {
  type DocumentStorage,
  type SaveDocumentInput,
  type SaveDocumentResult,
} from './document-storage.interface';

export const SUPABASE_STORAGE_CONFIG = Symbol('SUPABASE_STORAGE_CONFIG');

export interface SupabaseStorageConfig {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  readonly bucket: string;
}

/**
 * `SupabaseDocumentStorage` — cloud `DocumentStorage` driver backed by
 * Supabase Storage (S3-compatible object store).
 *
 * Storage key shape: `<orgId>/<sha256>.<ext>`
 *   - orgId isolates tenants in the same bucket.
 *   - sha256 content-addresses objects so duplicate uploads reuse the
 *     same physical object (upload is idempotent via `upsert: true`).
 *
 * The service-role key gives full admin access so RLS policies on the
 * bucket never block server-side operations. The bucket should be set
 * to PRIVATE (no public URLs) — all access flows through this service.
 */
@Injectable()
export class SupabaseDocumentStorage implements DocumentStorage {
  private readonly logger = new Logger(SupabaseDocumentStorage.name);
  private readonly config: SupabaseStorageConfig;
  private readonly bucket: string;
  private _client: SupabaseClient | null = null;

  constructor(@Inject(SUPABASE_STORAGE_CONFIG) config: SupabaseStorageConfig) {
    this.config = config;
    this.bucket = config.bucket;
  }

  private get client(): SupabaseClient {
    if (!this._client) {
      this._client = createClient(this.config.supabaseUrl, this.config.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return this._client;
  }

  async save(input: SaveDocumentInput): Promise<SaveDocumentResult> {
    const buffer = await this.toBuffer(input.body);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const ext = this.extensionFor(input.originalName);
    const storageKey = `${input.organizationId}/${sha256}${ext}`;

    const { error } = await this.client.storage.from(this.bucket).upload(storageKey, buffer, {
      contentType: input.mimeType,
      upsert: true,
    });

    if (error) {
      this.logger.warn(`save: Supabase upload failed: ${error.message}`);
      throw new AppException(ERROR_CODES.DOC_STORAGE_FAILURE, {
        message: 'Failed to persist document to Supabase Storage',
        cause: error,
      });
    }

    return { storageKey, sha256Checksum: sha256, sizeBytes: buffer.length };
  }

  async getStream(storageKey: string): Promise<Readable> {
    const { data, error } = await this.client.storage.from(this.bucket).download(storageKey);

    if (error !== null) {
      const isNotFound =
        error.message.toLowerCase().includes('not found') ||
        error.message.toLowerCase().includes('object not found') ||
        error.message.includes('404');

      if (isNotFound) {
        throw new AppException(ERROR_CODES.DOC_NOT_FOUND, {
          message: `Document bytes not found in Supabase Storage for storageKey='${storageKey}'`,
        });
      }

      throw new AppException(ERROR_CODES.DOC_STORAGE_FAILURE, {
        message: 'Failed to download document from Supabase Storage',
        cause: error,
      });
    }

    const arrayBuffer = await data.arrayBuffer();
    return Readable.from(Buffer.from(arrayBuffer));
  }

  async delete(storageKey: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([storageKey]);

    if (error !== null) {
      const isNotFound =
        error.message.toLowerCase().includes('not found') ||
        error.message.toLowerCase().includes('object not found');

      if (isNotFound) {
        return; // idempotent — deleting non-existent object is a no-op
      }

      throw new AppException(ERROR_CODES.DOC_STORAGE_FAILURE, {
        message: 'Failed to delete document from Supabase Storage',
        cause: error,
      });
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    const orgFolder = storageKey.split('/')[0] ?? '';
    const fileName = storageKey.split('/').slice(1).join('/');

    const { data, error } = await this.client.storage
      .from(this.bucket)
      .list(orgFolder, { search: fileName });

    if (error !== null) return false;
    return (data ?? []).some(
      (obj) => obj.name === fileName || `${orgFolder}/${obj.name}` === storageKey,
    );
  }

  private async toBuffer(body: Buffer | Readable): Promise<Buffer> {
    if (Buffer.isBuffer(body)) return body;
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    return Buffer.concat(chunks);
  }

  private extensionFor(originalName: string): string {
    const raw = path.extname(originalName).toLowerCase();
    if (raw.length === 0 || raw.length > 8 || !/^\.[a-z0-9]+$/i.test(raw)) {
      return '.bin';
    }
    return raw;
  }
}
