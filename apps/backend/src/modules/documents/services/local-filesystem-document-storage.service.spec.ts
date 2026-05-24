import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { LocalFilesystemDocumentStorage } from './local-filesystem-document-storage.service';

async function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

describe('LocalFilesystemDocumentStorage (BE-DOC-03)', () => {
  let rootDir: string;
  let storage: LocalFilesystemDocumentStorage;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-store-'));
    storage = new LocalFilesystemDocumentStorage(rootDir);
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  describe('save', () => {
    it('persists bytes, computes sha256, returns a content-addressed key', async () => {
      const orgId = randomUUID();
      const body = Buffer.from('hello world\n', 'utf8');
      const expectedSha = createHash('sha256').update(body).digest('hex');

      const result = await storage.save({
        organizationId: orgId,
        originalName: 'note.txt',
        mimeType: 'text/plain',
        body,
      });

      expect(result.sha256Checksum).toBe(expectedSha);
      expect(result.sizeBytes).toBe(body.length);
      expect(result.storageKey.startsWith(`${orgId}/`)).toBe(true);
      expect(result.storageKey.endsWith('.txt')).toBe(true);
      expect(result.storageKey).toContain(expectedSha);

      const absolute = path.resolve(rootDir, result.storageKey);
      const onDisk = await fs.readFile(absolute);
      expect(onDisk.equals(body)).toBe(true);
    });

    it('hashes a Readable stream input and computes the size from actual bytes', async () => {
      const orgId = randomUUID();
      const payload = Buffer.from('streamed content', 'utf8');
      const expectedSha = createHash('sha256').update(payload).digest('hex');

      const { Readable } = await import('stream');
      const stream = Readable.from([payload.subarray(0, 5), payload.subarray(5)]);

      const result = await storage.save({
        organizationId: orgId,
        originalName: 'streamed.bin',
        mimeType: 'application/octet-stream',
        body: stream,
      });

      expect(result.sha256Checksum).toBe(expectedSha);
      expect(result.sizeBytes).toBe(payload.length);
    });

    it('is idempotent on identical content (no second write)', async () => {
      const orgId = randomUUID();
      const body = Buffer.from('idempotent', 'utf8');

      const first = await storage.save({
        organizationId: orgId,
        originalName: 'a.txt',
        mimeType: 'text/plain',
        body,
      });
      const firstStat = await fs.stat(path.resolve(rootDir, first.storageKey));

      // Same bytes, same org → same key, second call must not touch
      // the file (mtime unchanged).
      await new Promise((resolve) => setTimeout(resolve, 20));
      const second = await storage.save({
        organizationId: orgId,
        originalName: 'a.txt',
        mimeType: 'text/plain',
        body,
      });
      const secondStat = await fs.stat(path.resolve(rootDir, second.storageKey));

      expect(second.storageKey).toBe(first.storageKey);
      expect(secondStat.mtimeMs).toBeCloseTo(firstStat.mtimeMs, 5);
    });

    it('rejects an organizationId containing path traversal segments', async () => {
      await expect(
        storage.save({
          organizationId: '../escape',
          originalName: 'x.txt',
          mimeType: 'text/plain',
          body: Buffer.from('nope'),
        }),
      ).rejects.toBeInstanceOf(AppException);
    });

    it('falls back to .bin when the original filename has no extension', async () => {
      const result = await storage.save({
        organizationId: randomUUID(),
        originalName: 'no-extension',
        mimeType: 'application/octet-stream',
        body: Buffer.from('payload'),
      });
      expect(result.storageKey.endsWith('.bin')).toBe(true);
    });
  });

  describe('getStream', () => {
    it('round-trips bytes through getStream', async () => {
      const body = Buffer.from('round trip payload', 'utf8');
      const result = await storage.save({
        organizationId: randomUUID(),
        originalName: 'rt.txt',
        mimeType: 'text/plain',
        body,
      });

      const stream = await storage.getStream(result.storageKey);
      const fetched = await readStreamToBuffer(stream);
      expect(fetched.equals(body)).toBe(true);
    });

    it('throws DOC_NOT_FOUND on a missing key', async () => {
      await expect(storage.getStream(`${randomUUID()}/2026/05/deadbeef.bin`)).rejects.toMatchObject(
        { code: ERROR_CODES.DOC_NOT_FOUND },
      );
    });

    it('refuses keys that try to escape the storage root', async () => {
      await expect(storage.getStream('../../../etc/passwd')).rejects.toMatchObject({
        code: ERROR_CODES.DOC_STORAGE_FAILURE,
      });
    });
  });

  describe('delete', () => {
    it('removes the persisted file', async () => {
      const body = Buffer.from('to-be-deleted', 'utf8');
      const result = await storage.save({
        organizationId: randomUUID(),
        originalName: 'd.txt',
        mimeType: 'text/plain',
        body,
      });

      await storage.delete(result.storageKey);

      expect(await storage.exists(result.storageKey)).toBe(false);
    });

    it('is idempotent on a missing key (ENOENT swallowed)', async () => {
      await expect(storage.delete(`${randomUUID()}/2026/05/cafe.bin`)).resolves.toBeUndefined();
    });
  });

  describe('exists', () => {
    it('reflects file presence', async () => {
      const body = Buffer.from('exists', 'utf8');
      const result = await storage.save({
        organizationId: randomUUID(),
        originalName: 'e.txt',
        mimeType: 'text/plain',
        body,
      });

      expect(await storage.exists(result.storageKey)).toBe(true);
      await storage.delete(result.storageKey);
      expect(await storage.exists(result.storageKey)).toBe(false);
    });
  });
});
