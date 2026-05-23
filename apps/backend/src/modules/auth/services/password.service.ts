import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';

import { PASSWORD_HASH_OPTIONS } from '../config/password.config';

/**
 * `PasswordService` (BE-CRYPTO-01) — Argon2id hashing & verification.
 *
 * The only entry-points in the codebase allowed to touch raw passwords.
 * Plaintext never leaves a `hashPassword` / `verifyPassword` call and is
 * never logged. Work-factor parameters are centralized in
 * `PASSWORD_HASH_OPTIONS` (cf. `../config/password.config.ts`).
 *
 * `verifyPassword` is constant-time (delegated to libsodium-backed
 * `argon2.verify`) and swallows parse errors on the stored hash by returning
 * `false`. A corrupt or mis-algorithm row therefore cannot leak which user
 * it belongs to via a different error path.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  async hashPassword(plain: string): Promise<string> {
    if (typeof plain !== 'string' || plain.length === 0) {
      throw new Error('PasswordService.hashPassword: plaintext must be a non-empty string');
    }
    return argon2.hash(plain, PASSWORD_HASH_OPTIONS);
  }

  async verifyPassword(hash: string, plain: string): Promise<boolean> {
    if (typeof hash !== 'string' || hash.length === 0) {
      return false;
    }
    if (typeof plain !== 'string' || plain.length === 0) {
      return false;
    }

    try {
      return await argon2.verify(hash, plain);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`verifyPassword: malformed/incompatible hash rejected (${message})`);
      return false;
    }
  }
}
