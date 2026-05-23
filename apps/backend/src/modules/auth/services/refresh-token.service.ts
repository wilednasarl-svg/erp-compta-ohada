import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { CLOCK, type Clock } from '../../../common/time/clock';
import type { AppConfig } from '../../../config/configuration';
import { AuthEventsService } from '../../audit/services/auth-events.service';
import { RefreshTokenRepository } from '../repositories/refresh-token.repository';
import { parseDurationToMs } from '../config/jwt.config';

/**
 * `RefreshTokenService` (BE-CRYPTO-04) — opaque-token issuance, rotation,
 * and reuse detection backing the refresh flow defined in
 * `specs/auth/spec.md` (Requirement: Refresh token rotation with reuse
 * detection).
 *
 * Wire shape:
 *   - Token  : 32 bytes of CSPRNG entropy, URL-safe base64 (no padding).
 *              The plaintext is returned ONCE from `issue` / `rotate` and
 *              never persisted — only the SHA-256 hex digest goes into
 *              `refresh_tokens.token_hash`.
 *   - Family : a UUID generated at the first issuance and propagated by
 *              every subsequent rotation. Used to revoke the entire
 *              chain when reuse is detected.
 *
 * Reuse detection (rotate):
 *   1. Hash the presented plaintext, look it up.
 *   2. If absent → invalid token (401).
 *   3. If `revokedAt != null` OR `usedAt != null` → the chain was already
 *      consumed — revoke the whole `familyId`, write
 *      `auth.refresh_token_reuse_detected`, throw `AUTH_REFRESH_REUSE`.
 *   4. If `expiresAt <= now` → expired (401).
 *   5. Otherwise: mark the presented row `usedAt = now`, issue a fresh
 *      token within the same `familyId`, return the plaintext + metadata.
 *
 * `Clock` is injected for deterministic tests (so `usedAt` / `expiresAt`
 * are predictable without `jest.useFakeTimers()`).
 */
export interface IssueRefreshTokenInput {
  readonly userId: string;
  readonly organizationId?: string | null;
  /**
   * When omitted, a fresh `familyId` is minted (new login flow). When
   * provided, the new token joins an existing family (internal call from
   * `rotate`).
   */
  readonly familyId?: string;
}

export interface IssuedRefreshToken {
  readonly token: string;
  readonly familyId: string;
  readonly expiresAt: Date;
  readonly userId: string;
  readonly organizationId: string | null;
}

/**
 * Per-request context optionally plumbed from the refresh controller so
 * a reuse-detection event carries the originating IP / user-agent. Both
 * fields are optional: a unit-test caller or a system-internal rotation
 * can omit them and the audit row records `null`.
 */
export interface RotateContext {
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

@Injectable()
export class RefreshTokenService {
  private static readonly TOKEN_BYTES = 32;

  private readonly refreshTtlMs: number;

  constructor(
    configService: ConfigService<AppConfig, true>,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly repo: RefreshTokenRepository,
    private readonly authEvents: AuthEventsService,
  ) {
    const jwt = configService.get('jwt', { infer: true });
    this.refreshTtlMs = parseDurationToMs(jwt.refreshTtl);
  }

  async issue(input: IssueRefreshTokenInput): Promise<IssuedRefreshToken> {
    if (typeof input.userId !== 'string' || input.userId.length === 0) {
      throw new Error('RefreshTokenService.issue: `userId` must be a non-empty string');
    }
    const token = this.mintToken();
    const tokenHash = this.hashToken(token);
    const familyId = input.familyId ?? randomUUID();
    const expiresAt = new Date(this.clock.nowMs() + this.refreshTtlMs);
    const organizationId = input.organizationId ?? null;

    await this.repo.issue({
      userId: input.userId,
      organizationId,
      tokenHash,
      familyId,
      expiresAt,
    });

    return { token, familyId, expiresAt, userId: input.userId, organizationId };
  }

  async rotate(presentedToken: string, context: RotateContext = {}): Promise<IssuedRefreshToken> {
    if (typeof presentedToken !== 'string' || presentedToken.length === 0) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, { message: 'Invalid token' });
    }

    const presentedHash = this.hashToken(presentedToken);
    const existing = await this.repo.findByTokenHash(presentedHash);
    if (existing === null) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, { message: 'Invalid token' });
    }

    const now = this.clock.now();

    if (existing.revokedAt !== null || existing.usedAt !== null) {
      // Reuse — kill the whole family and emit a forensic event so an
      // admin can correlate the incident with the originating IP/agent
      // (passed in by the controller via `context`).
      await this.repo.revokeFamily(existing.familyId, now);
      await this.authEvents.record(
        'auth.refresh_token_reuse_detected',
        {
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
          userId: existing.userId,
          organizationId: existing.organizationId,
        },
        {
          familyId: existing.familyId,
          presentedTokenId: existing.id,
          presentedTokenWasUsed: existing.usedAt !== null,
          presentedTokenWasRevoked: existing.revokedAt !== null,
        },
      );
      throw new AppException(ERROR_CODES.AUTH_REFRESH_REUSE, {
        message: 'Refresh token has already been consumed',
      });
    }

    if (existing.expiresAt.getTime() <= now.getTime()) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, { message: 'Refresh token expired' });
    }

    // Happy path: mark the presented token consumed, mint a new sibling.
    await this.repo.markUsed(existing.id, now);
    return this.issue({
      userId: existing.userId,
      organizationId: existing.organizationId,
      familyId: existing.familyId,
    });
  }

  async revoke(presentedToken: string): Promise<void> {
    if (typeof presentedToken !== 'string' || presentedToken.length === 0) {
      return;
    }
    const tokenHash = this.hashToken(presentedToken);
    const existing = await this.repo.findByTokenHash(tokenHash);
    if (existing === null || existing.revokedAt !== null) {
      return;
    }
    await this.repo.revokeById(existing.id, this.clock.now());
  }

  async revokeFamily(familyId: string): Promise<void> {
    if (typeof familyId !== 'string' || familyId.length === 0) {
      return;
    }
    await this.repo.revokeFamily(familyId, this.clock.now());
  }

  private mintToken(): string {
    return randomBytes(RefreshTokenService.TOKEN_BYTES).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
