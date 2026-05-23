import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { AppConfig } from '../../../config/configuration';

/**
 * `EncryptionService` (BE-CRYPTO-02) — symmetric authenticated encryption for
 * sensitive blobs stored in Postgres (initially `mfa_configs.secret_encrypted`,
 * later reusable for any other secret-at-rest concern).
 *
 * Algorithm: AES-256-GCM (NIST SP 800-38D). Each call to `encrypt` draws a
 * fresh 96-bit IV from the OS CSPRNG so two encryptions of the same plaintext
 * never collide — this is mandatory for GCM, where IV reuse with the same key
 * leaks the XOR of the two plaintexts and destroys integrity.
 *
 * Wire format (returned by `encrypt`, expected by `decrypt`):
 *
 *     [ iv (12 bytes) | auth_tag (16 bytes) | ciphertext (n bytes) ]
 *
 * Total length is therefore `28 + plaintext.length` bytes. The IV is stored
 * inline rather than in a separate column because it is non-secret and bound
 * to the ciphertext for life; storing them together keeps the schema simple
 * and avoids accidental mismatches.
 *
 * `decrypt` returns the plaintext only if GCM authentication succeeds; any
 * tampering of IV, tag or ciphertext makes `decipher.final()` throw and the
 * service surfaces a generic `authentication failed` error — never the
 * underlying reason, to avoid leaking oracle bits.
 *
 * The 256-bit key is read once at construction time from
 * `config.mfa.encryptionKey` (validated by Zod as a base64 string decoding to
 * exactly 32 bytes — cf. `src/config/env.validation.ts`). The service caches
 * the decoded key as a `Buffer` so we don't re-decode on every call.
 */
@Injectable()
export class EncryptionService {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 12;
  private static readonly AUTH_TAG_LENGTH = 16;
  private static readonly KEY_LENGTH = 32;

  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer;

  constructor(configService: ConfigService<AppConfig, true>) {
    const mfa = configService.get('mfa', { infer: true });
    const decoded = Buffer.from(mfa.encryptionKey, 'base64');
    if (decoded.length !== EncryptionService.KEY_LENGTH) {
      throw new Error(
        `EncryptionService: encryption key must decode to ${EncryptionService.KEY_LENGTH} bytes ` +
          `(got ${decoded.length}). Check MFA_ENCRYPTION_KEY in your environment.`,
      );
    }
    this.key = decoded;
  }

  /**
   * Encrypts a UTF-8 string or raw byte buffer.
   *
   * Returns a `Buffer` formatted as `iv || tag || ciphertext` (see class
   * doc). Callers persisting the result to Postgres `BYTEA` (e.g.
   * `mfa_configs.secret_encrypted`) can write the buffer as-is.
   *
   * Declared `async` deliberately even though the body is synchronous: the
   * Promise-based public API gives us room to swap in a hardware-backed
   * cipher (KMS, HSM) without breaking callers, and Jest's
   * `rejects.toThrow` matcher (used by the spec) requires a Promise return.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async encrypt(plain: Buffer | string): Promise<Buffer> {
    if (plain === null || plain === undefined) {
      throw new Error('EncryptionService.encrypt: input must be a Buffer or string');
    }
    const plaintext = typeof plain === 'string' ? Buffer.from(plain, 'utf8') : Buffer.from(plain);

    const iv = randomBytes(EncryptionService.IV_LENGTH);
    const cipher = createCipheriv(EncryptionService.ALGORITHM, this.key, iv, {
      authTagLength: EncryptionService.AUTH_TAG_LENGTH,
    });
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]);
  }

  /**
   * Decrypts a buffer (or base64 string) previously produced by `encrypt`.
   *
   * @throws Error  when the input is too short to contain `iv || tag`, or
   *                when GCM authentication fails (wrong key, corrupted
   *                ciphertext, tampered IV/tag). The error message is
   *                intentionally generic to avoid leaking which part failed.
   *
   * Same `async`/sync rationale as `encrypt` — see that method's docblock.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async decrypt(cipher: Buffer | string): Promise<Buffer> {
    if (cipher === null || cipher === undefined) {
      throw new Error('EncryptionService.decrypt: input must be a Buffer or string');
    }
    const buf = typeof cipher === 'string' ? Buffer.from(cipher, 'base64') : Buffer.from(cipher);

    const minLength = EncryptionService.IV_LENGTH + EncryptionService.AUTH_TAG_LENGTH;
    if (buf.length < minLength) {
      throw new Error(
        `EncryptionService.decrypt: ciphertext is too short (got ${buf.length} bytes, ` +
          `need at least ${minLength} for iv+tag).`,
      );
    }

    const iv = buf.subarray(0, EncryptionService.IV_LENGTH);
    const tag = buf.subarray(EncryptionService.IV_LENGTH, minLength);
    const ciphertext = buf.subarray(minLength);

    const decipher = createDecipheriv(EncryptionService.ALGORITHM, this.key, iv, {
      authTagLength: EncryptionService.AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(tag);

    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`decrypt: GCM authentication failed (${message})`);
      throw new Error('EncryptionService.decrypt: authentication failed');
    }
  }
}
