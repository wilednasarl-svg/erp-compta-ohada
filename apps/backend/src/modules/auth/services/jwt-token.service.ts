import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JsonWebTokenError,
  NotBeforeError,
  TokenExpiredError,
  sign as jwtSign,
  verify as jwtVerify,
  type JwtPayload,
  type SignOptions,
} from 'jsonwebtoken';

import {
  type AccessTokenClaims,
  INVITATION_TTL,
  type InvitationTokenClaims,
  JWT_ALGORITHM,
  JWT_ISSUER,
  JWT_PURPOSE,
  MFA_CHALLENGE_TTL,
  type MfaChallengeClaims,
} from '../config/jwt.config';
import type { AppConfig } from '../../../config/configuration';
import { CLOCK, type Clock } from '../../../common/time/clock';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { AppException } from '../../../common/errors/app-exception';

export interface SignAccessTokenInput {
  readonly sub: string;
  readonly orgId?: string;
  readonly role?: string;
  readonly mfaVerified?: boolean;
}

export interface SignMfaChallengeTokenInput {
  readonly sub: string;
}

export interface SignInvitationTokenInput {
  /** Inviter user id — bound to the JWT `sub` for audit provenance. */
  readonly sub: string;
  readonly invitationId: string;
  readonly orgId: string;
  readonly roleId: string;
}

/**
 * `JwtTokenService` (BE-CRYPTO-03) — HS256 issuance & verification for the
 * two short-lived bearer tokens used by Module 1:
 *
 *   - **Access token**: TTL `JWT_ACCESS_TTL` (default 15m), claims
 *     `{ sub, purpose: 'access', org_id?, role?, mfa_verified?, iat, exp, iss }`.
 *     Consumed by every guard on protected endpoints.
 *
 *   - **MFA challenge token**: TTL 5m (constant), claims
 *     `{ sub, purpose: 'mfa_challenge', iat, exp, iss }`. Issued by
 *     `POST /auth/login` when the user has MFA enabled, exchanged at
 *     `POST /auth/mfa/verify` for a real access token.
 *
 * Cross-purpose usage is rejected: `verifyAccessToken` refuses any token
 * whose `purpose` is not `'access'`, and `verifyMfaChallengeToken`
 * refuses any token whose `purpose` is not `'mfa_challenge'`. This is
 * the spec test in BE-CRYPTO-03 ("rejet d'un access token utilisé comme
 * challenge MFA et vice-versa").
 *
 * All verification failures (bad signature, expired, wrong issuer, wrong
 * purpose, malformed) surface as `AppException(AUTH_INVALID_TOKEN, 401)`
 * — never the underlying jsonwebtoken error message, to avoid leaking
 * oracle bits about why a token was rejected.
 *
 * The signing secret is read once at construction from `config.jwt.secret`
 * (validated by Zod as ≥ 32 chars in `env.validation.ts`). A `Clock` is
 * injected so unit tests can produce deterministic `iat`/`exp` claims
 * without relying on `jest.useFakeTimers()`.
 */
@Injectable()
export class JwtTokenService {
  private readonly logger = new Logger(JwtTokenService.name);
  private readonly secret: string;
  private readonly accessTtl: string;

  constructor(
    configService: ConfigService<AppConfig, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    const jwt = configService.get('jwt', { infer: true });
    this.secret = jwt.secret;
    this.accessTtl = jwt.accessTtl;
  }

  signAccessToken(input: SignAccessTokenInput): string {
    if (typeof input.sub !== 'string' || input.sub.length === 0) {
      throw new Error('JwtTokenService.signAccessToken: `sub` must be a non-empty string');
    }
    const payload: Omit<AccessTokenClaims, 'iat' | 'exp' | 'iss'> = {
      sub: input.sub,
      purpose: JWT_PURPOSE.ACCESS,
      ...(input.orgId !== undefined ? { org_id: input.orgId } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.mfaVerified !== undefined ? { mfa_verified: input.mfaVerified } : {}),
    };
    return this.sign(payload, this.accessTtl);
  }

  signMfaChallengeToken(input: SignMfaChallengeTokenInput): string {
    if (typeof input.sub !== 'string' || input.sub.length === 0) {
      throw new Error('JwtTokenService.signMfaChallengeToken: `sub` must be a non-empty string');
    }
    const payload: Omit<MfaChallengeClaims, 'iat' | 'exp' | 'iss'> = {
      sub: input.sub,
      purpose: JWT_PURPOSE.MFA_CHALLENGE,
    };
    return this.sign(payload, MFA_CHALLENGE_TTL);
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const claims = this.verify(token);
    if (claims.purpose !== JWT_PURPOSE.ACCESS) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, { message: 'Invalid token' });
    }
    // Guard required fields BEFORE casting. A token signed with our
    // secret but missing `sub` (or another required claim) would otherwise
    // slip through and surface as a runtime `undefined` in downstream
    // guards. `org_id`, `role`, and `mfa_verified` are intentionally
    // optional in the access-token shape.
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, { message: 'Invalid token' });
    }
    return claims as AccessTokenClaims;
  }

  verifyMfaChallengeToken(token: string): MfaChallengeClaims {
    const claims = this.verify(token);
    if (claims.purpose !== JWT_PURPOSE.MFA_CHALLENGE) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, { message: 'Invalid token' });
    }
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, { message: 'Invalid token' });
    }
    return claims as MfaChallengeClaims;
  }

  signInvitationToken(input: SignInvitationTokenInput): string {
    if (typeof input.sub !== 'string' || input.sub.length === 0) {
      throw new Error('JwtTokenService.signInvitationToken: `sub` must be a non-empty string');
    }
    if (typeof input.invitationId !== 'string' || input.invitationId.length === 0) {
      throw new Error('JwtTokenService.signInvitationToken: `invitationId` is required');
    }
    if (typeof input.orgId !== 'string' || input.orgId.length === 0) {
      throw new Error('JwtTokenService.signInvitationToken: `orgId` is required');
    }
    if (typeof input.roleId !== 'string' || input.roleId.length === 0) {
      throw new Error('JwtTokenService.signInvitationToken: `roleId` is required');
    }
    const payload: Omit<InvitationTokenClaims, 'iat' | 'exp' | 'iss'> = {
      sub: input.sub,
      purpose: JWT_PURPOSE.INVITATION,
      invitation_id: input.invitationId,
      org_id: input.orgId,
      role_id: input.roleId,
    };
    return this.sign(payload, INVITATION_TTL);
  }

  /**
   * Decode the invitation token but do NOT enforce expiry here — the
   * `InvitationsService.accept` flow distinguishes "JWT expired"
   * (returns `INVITATION_EXPIRED`, 410) from "JWT cryptographically
   * invalid" (returns `INVITATION_NOT_FOUND`, 404, since we cannot
   * distinguish a forged token from one for a non-existent invitation).
   * Throwing `AUTH_INVALID_TOKEN` here would lose that nuance.
   *
   * Spec-grade behavior:
   *   - Signature / issuer / shape invalid → `INVITATION_NOT_FOUND`.
   *   - `purpose !== 'invitation'` → `INVITATION_NOT_FOUND`.
   *   - `exp <= now` → `INVITATION_EXPIRED`.
   *   - Otherwise → return claims.
   */
  verifyInvitationToken(token: string): InvitationTokenClaims {
    if (typeof token !== 'string' || token.length === 0) {
      throw new AppException(ERROR_CODES.INVITATION_NOT_FOUND, {
        message: 'Invitation not found',
      });
    }
    try {
      const decoded = jwtVerify(token, this.secret, {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        clockTimestamp: Math.floor(this.clock.nowMs() / 1000),
      });
      if (typeof decoded === 'string') {
        throw new AppException(ERROR_CODES.INVITATION_NOT_FOUND, {
          message: 'Invitation not found',
        });
      }
      const claims = decoded as JwtPayload & {
        purpose?: string;
        sub?: string;
        org_id?: string;
        role_id?: string;
        invitation_id?: string;
      };
      if (claims.purpose !== JWT_PURPOSE.INVITATION) {
        throw new AppException(ERROR_CODES.INVITATION_NOT_FOUND, {
          message: 'Invitation not found',
        });
      }
      // Reject a JWT that is signed correctly but missing any of the
      // required invitation claims. Without these guards an attacker
      // who finds an HMAC signing oracle (or a leak of the secret) could
      // mint a token that passes the `purpose` check but contains
      // garbage payload, leaving downstream code dereferencing
      // `undefined`.
      if (
        typeof claims.sub !== 'string' ||
        typeof claims.org_id !== 'string' ||
        typeof claims.role_id !== 'string' ||
        typeof claims.invitation_id !== 'string'
      ) {
        throw new AppException(ERROR_CODES.INVITATION_NOT_FOUND, {
          message: 'Invitation not found',
        });
      }
      return claims as InvitationTokenClaims;
    } catch (error: unknown) {
      if (error instanceof TokenExpiredError) {
        this.logger.warn(`verifyInvitationToken: token expired (${error.message})`);
        throw new AppException(ERROR_CODES.INVITATION_EXPIRED, {
          message: 'Invitation expired',
          cause: error,
        });
      }
      if (error instanceof JsonWebTokenError || error instanceof NotBeforeError) {
        this.logger.warn(`verifyInvitationToken: rejected token (${error.name}: ${error.message})`);
        throw new AppException(ERROR_CODES.INVITATION_NOT_FOUND, {
          message: 'Invitation not found',
          cause: error,
        });
      }
      throw error;
    }
  }

  private sign(payload: Record<string, unknown>, expiresIn: string): string {
    const options: SignOptions = {
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      // `expiresIn` accepts the same vocabulary as the env var
      // (`15m`, `1h`, `604800`); cast satisfies the `StringValue` type
      // exported by `jsonwebtoken`.
      expiresIn: expiresIn as unknown as SignOptions['expiresIn'],
      // Pin `iat` to the injected clock so tests can produce a
      // deterministic token. In production, `nowMs()` is wall-clock.
      noTimestamp: false,
    };
    return jwtSign(
      { ...payload, iat: Math.floor(this.clock.nowMs() / 1000) },
      this.secret,
      options,
    );
  }

  private verify(token: string): JwtPayload & { purpose?: string } {
    if (typeof token !== 'string' || token.length === 0) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, { message: 'Invalid token' });
    }
    try {
      const decoded = jwtVerify(token, this.secret, {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        // Use the injected clock so tests can expire tokens by
        // advancing the clock without `jest.useFakeTimers()`.
        clockTimestamp: Math.floor(this.clock.nowMs() / 1000),
      });
      if (typeof decoded === 'string') {
        // A string payload would mean an unsigned blob we never produce;
        // refuse defensively so a future code-path that drops `purpose`
        // still fails closed.
        throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, { message: 'Invalid token' });
      }
      return decoded as JwtPayload & { purpose?: string };
    } catch (error: unknown) {
      if (
        error instanceof TokenExpiredError ||
        error instanceof JsonWebTokenError ||
        error instanceof NotBeforeError
      ) {
        this.logger.warn(`verify: rejected token (${error.name}: ${error.message})`);
        throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
          message: 'Invalid token',
          cause: error,
        });
      }
      throw error;
    }
  }
}
