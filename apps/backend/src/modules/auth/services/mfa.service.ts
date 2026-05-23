import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { AuthEventContext } from '../../audit/services/auth-events.service';
import { AuthEventsService } from '../../audit/services/auth-events.service';
import type { MfaConfigEntity } from '../entities/mfa-config.entity';
import { MfaConfigRepository } from '../repositories/mfa-config.repository';
import { UserRepository } from '../repositories/user.repository';
import {
  BACKUP_CODE_COUNT,
  TOTP_DIGITS,
  TOTP_ISSUER,
  TOTP_PERIOD,
  TOTP_WINDOW,
} from '../config/mfa.config';
import { EncryptionService } from './encryption.service';
import { PasswordService } from './password.service';

/**
 * Result of `setup`. The plaintext `secret` is returned ONCE so the
 * frontend can render the QR + a copy-to-clipboard fallback; the
 * server only ever persists the AES-256-GCM ciphertext.
 */
export interface MfaSetupResult {
  readonly secret: string;
  readonly otpauthUri: string;
}

/**
 * Result of `verify` (activation). The `backupCodes` are returned ONCE
 * in plaintext; only their argon2id hashes survive on the row. The user
 * MUST save them — there is no recovery path beyond a manual admin
 * reset (out-of-band).
 */
export interface MfaActivationResult {
  readonly backupCodes: ReadonlyArray<string>;
}

export interface MfaVerifyInput {
  readonly code: string;
}

/**
 * `MfaService` (BE-AUTH-MFA-01..04) — TOTP (RFC 6238) enrollment,
 * activation, disablement, and login-challenge consumption.
 *
 * Flow surfaces:
 *
 *   - `setup(userId)`           — generates a 160-bit base32 secret,
 *                                  encrypts with AES-256-GCM, upserts the
 *                                  `mfa_configs` row with `enabled=false`.
 *                                  Returns the plaintext secret + the
 *                                  `otpauth://totp/...` URI suitable for
 *                                  QR rendering. Idempotent: a second
 *                                  call before activation rotates the
 *                                  secret (lets the user start over if
 *                                  they lost the QR before scanning).
 *
 *   - `activate(userId, code)`  — confirms a freshly-issued TOTP code
 *                                  against the encrypted secret. On
 *                                  success: flips `enabled=true`,
 *                                  generates 10 backup codes (hashed
 *                                  argon2id), stores them, emits
 *                                  `auth.mfa_enabled`, returns the
 *                                  plaintext codes ONCE.
 *
 *   - `disable(userId)`         — flips `enabled=false`, wipes backup
 *                                  codes, keeps the encrypted secret on
 *                                  disk (the row stays for audit; a
 *                                  fresh `setup` overwrites). Emits
 *                                  `auth.mfa_disabled`.
 *
 *   - `verifyLoginChallenge(userId, code, isBackupCode?)`
 *                               — consumed by `AuthService.completeMfaLogin`.
 *                                  Validates either a TOTP code or a
 *                                  single-use backup code (which is
 *                                  removed from the row on consumption).
 *                                  On failure emits
 *                                  `auth.mfa_verification_failed` and
 *                                  throws `AUTH_MFA_INVALID_CODE`.
 *
 * All `code` parameters are expected to be already stripped of spaces /
 * dashes by the caller (DTO-level concern). Constant-time comparison is
 * delegated to `otplib` (TOTP) and `argon2.verify` (backup codes).
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly mfaConfigs: MfaConfigRepository,
    private readonly users: UserRepository,
    private readonly encryption: EncryptionService,
    private readonly passwords: PasswordService,
    private readonly audit: AuthEventsService,
  ) {
    // Pin otplib options to the project policy. `authenticator.options`
    // is module-level state in otplib v12, so re-setting on every
    // construction keeps us robust against a stray override elsewhere.
    authenticator.options = {
      digits: TOTP_DIGITS,
      step: TOTP_PERIOD,
      window: TOTP_WINDOW,
    };
  }

  async setup(userId: string): Promise<MfaSetupResult> {
    const existing = await this.mfaConfigs.findByUserId(userId);
    if (existing !== null && existing.enabled) {
      throw new AppException(ERROR_CODES.AUTH_MFA_ALREADY_ENABLED, {
        message: 'MFA is already enabled for this account',
      });
    }

    const user = await this.users.findActiveById(userId);
    if (user === null) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'User no longer exists',
      });
    }

    // 160-bit base32 string — the de-facto standard size read by Google
    // Authenticator / Authy / 1Password.
    const secret = authenticator.generateSecret();
    const secretEncrypted = await this.encryption.encrypt(secret);
    await this.mfaConfigs.upsertSecret({ userId, secretEncrypted });

    const otpauthUri = authenticator.keyuri(user.email, TOTP_ISSUER, secret);

    return { secret, otpauthUri };
  }

  async activate(
    userId: string,
    input: MfaVerifyInput,
    context: AuthEventContext,
  ): Promise<MfaActivationResult> {
    const config = await this.mfaConfigs.findByUserId(userId);
    if (config === null) {
      throw new AppException(ERROR_CODES.AUTH_MFA_NOT_ENROLLED, {
        message: 'MFA setup has not been initialized',
      });
    }
    if (config.enabled) {
      throw new AppException(ERROR_CODES.AUTH_MFA_ALREADY_ENABLED, {
        message: 'MFA is already enabled for this account',
      });
    }

    const ok = await this.verifyTotpCode(config, input.code);
    if (!ok) {
      await this.audit.record(
        'auth.mfa_verification_failed',
        { ...context, userId, organizationId: null },
        { phase: 'activation' },
      );
      throw new AppException(ERROR_CODES.AUTH_MFA_INVALID_CODE, {
        message: 'Invalid MFA code',
      });
    }

    const plainBackupCodes = this.generateBackupCodes();
    const hashed = await Promise.all(plainBackupCodes.map((c) => this.passwords.hashPassword(c)));
    await this.mfaConfigs.activate(userId, hashed, new Date());

    await this.audit.record('auth.mfa_enabled', { ...context, userId, organizationId: null }, {});

    return { backupCodes: plainBackupCodes };
  }

  async disable(userId: string, context: AuthEventContext): Promise<void> {
    const config = await this.mfaConfigs.findByUserId(userId);
    if (config === null || !config.enabled) {
      throw new AppException(ERROR_CODES.AUTH_MFA_NOT_ENROLLED, {
        message: 'MFA is not enabled for this account',
      });
    }
    // The current spec exposes disable behind `JwtAuthGuard` alone — the
    // active session is the proof of intent. A future hardening pass
    // (BE-AUTH-MFA-STEP-UP) may require a fresh TOTP / backup code to
    // defend against a stolen access token.
    await this.mfaConfigs.disable(userId);
    await this.audit.record('auth.mfa_disabled', { ...context, userId, organizationId: null }, {});
  }

  /**
   * Consume a code during the login MFA challenge. Either a 6-digit TOTP
   * code or one of the 10 single-use backup codes (the service
   * disambiguates by length — backup codes are 8 base32 chars, TOTP
   * codes are 6 numeric digits).
   *
   * Throws on failure with a generic `AUTH_MFA_INVALID_CODE` so the
   * client cannot distinguish "wrong TOTP" from "backup code already
   * consumed" — an information leak that would shrink the attacker
   * search space.
   */
  async verifyLoginChallenge(
    userId: string,
    code: string,
    context: AuthEventContext,
  ): Promise<void> {
    const config = await this.mfaConfigs.findByUserId(userId);
    if (config === null || !config.enabled) {
      // The user has a valid challenge token but no active MFA row —
      // refuse, since we'd otherwise let a stale challenge bypass MFA.
      await this.audit.record(
        'auth.mfa_verification_failed',
        { ...context, userId, organizationId: null },
        { reason: 'mfa_not_enabled' },
      );
      throw new AppException(ERROR_CODES.AUTH_MFA_INVALID_CODE, {
        message: 'Invalid MFA code',
      });
    }

    const trimmed = code.replace(/[\s-]+/g, '');
    const looksLikeBackupCode = /^[A-Z2-7]{8}$/u.test(trimmed.toUpperCase());

    if (looksLikeBackupCode) {
      const consumedAt = await this.tryConsumeBackupCode(config, trimmed.toUpperCase());
      if (!consumedAt) {
        await this.audit.record(
          'auth.mfa_verification_failed',
          { ...context, userId, organizationId: null },
          { phase: 'login', via: 'backup_code' },
        );
        throw new AppException(ERROR_CODES.AUTH_MFA_INVALID_CODE, {
          message: 'Invalid MFA code',
        });
      }
      return;
    }

    const ok = await this.verifyTotpCode(config, trimmed);
    if (!ok) {
      await this.audit.record(
        'auth.mfa_verification_failed',
        { ...context, userId, organizationId: null },
        { phase: 'login', via: 'totp' },
      );
      throw new AppException(ERROR_CODES.AUTH_MFA_INVALID_CODE, {
        message: 'Invalid MFA code',
      });
    }
  }

  private async verifyTotpCode(config: MfaConfigEntity, code: string): Promise<boolean> {
    if (!/^\d{6}$/u.test(code)) {
      return false;
    }
    let secret: string;
    try {
      const decrypted = await this.encryption.decrypt(config.secretEncrypted);
      secret = decrypted.toString('utf8');
    } catch {
      // Tampered ciphertext / wrong key — refuse closed without leaking
      // the underlying reason. The decrypt path already logs at WARN.
      return false;
    }
    return authenticator.check(code, secret);
  }

  /**
   * Walk the hashed backup codes; on the first argon2 match, remove that
   * entry and persist the shrunken array. Returns `true` if a code was
   * consumed, `false` if no match.
   *
   * The loop is sequential to keep the implementation easy to audit —
   * `argon2.verify` is intentionally slow, so 10 sequential verifies is
   * tens of ms per attempt, which doubles as rate limiting at zero
   * implementation cost.
   */
  private async tryConsumeBackupCode(config: MfaConfigEntity, candidate: string): Promise<boolean> {
    for (let i = 0; i < config.backupCodesHashed.length; i += 1) {
      const hash = config.backupCodesHashed[i];
      const matched = await this.passwords.verifyPassword(hash, candidate);
      if (matched) {
        const remaining = [
          ...config.backupCodesHashed.slice(0, i),
          ...config.backupCodesHashed.slice(i + 1),
        ];
        await this.mfaConfigs.consumeBackupCode(config.userId, remaining);
        return true;
      }
    }
    return false;
  }

  /**
   * Generate `BACKUP_CODE_COUNT` independent base32 codes. The encoding
   * keeps them visually distinguishable on print (no `0/O`, no `1/I/L`)
   * and short enough to type by hand.
   *
   * We use `crypto.randomBytes` + a base32 alphabet rather than UUIDs to
   * keep the printable form short (8 chars vs 36) and to avoid mixed-case
   * which is awkward to read off paper.
   */
  private generateBackupCodes(): string[] {
    // Base32 RFC 4648 alphabet minus the visually-ambiguous `0/O/1/I/L`
    // characters (so a user reading off paper doesn't transcribe a `0`
    // as `O`). 32 symbols → 5 bits per character.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const codes: string[] = [];
    for (let i = 0; i < BACKUP_CODE_COUNT; i += 1) {
      // Take 8 bytes of CSPRNG entropy and emit one base32 char per
      // byte (consuming the low 5 bits each). 8 chars × 5 bits = 40
      // bits of entropy per code, which is plenty for a single-use,
      // rate-limited fallback.
      const raw = randomBytes(8);
      let out = '';
      for (let b = 0; b < raw.length; b += 1) {
        out += alphabet[raw[b] & 0x1f];
      }
      codes.push(out);
    }
    return codes;
  }
}
