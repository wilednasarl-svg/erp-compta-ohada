import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { AuthEventsService } from '../../audit/services/auth-events.service';
import { MembershipRepository } from '../../rbac/repositories/membership.repository';
import { RoleRepository } from '../../rbac/repositories/role.repository';
import { MfaConfigRepository } from '../repositories/mfa-config.repository';
import { UserRepository } from '../repositories/user.repository';
import { JwtTokenService } from './jwt-token.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';

/**
 * Minimum password length per `specs/auth/spec.md` (Requirement: User
 * signup with email and password). Kept as a centralized constant so a
 * future bump (or HIBP check toggle) only touches this file.
 */
const PASSWORD_MIN_LENGTH = 12;

export interface RequestContext {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface SignupInput {
  readonly email: string;
  readonly password: string;
  readonly firstName?: string;
  readonly lastName?: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface PublicUser {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
}

export interface SignupResult {
  readonly user: PublicUser;
}

/**
 * Discriminated union for the login response. `mfa_required: false`
 * carries the full token pair; `mfa_required: true` carries only the
 * short-lived MFA challenge token (5 min) which must be exchanged at
 * `POST /auth/mfa/verify` (BE-AUTH-MFA, deferred). The discriminator
 * field name matches the wire contract documented in the spec verbatim.
 */
export type LoginResult =
  | {
      readonly mfa_required: false;
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly user: PublicUser;
      // Listed for spec compliance. Fed by MembershipService.listByUser
      // once Organizations module is wired (BE-ORG-*); empty for now.
      readonly organizations: ReadonlyArray<{ id: string; name: string; role: string }>;
    }
  | {
      readonly mfa_required: true;
      readonly mfaChallengeToken: string;
    };

export interface RefreshResult {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/**
 * `POST /auth/select-organization` response. The token pair is fully
 * scoped (`org_id` + `role` claims on the access token; `organization_id`
 * column on the refresh row) so every downstream tenant-scoped route can
 * trust the JWT alone.
 */
export interface SelectOrganizationResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly role: string;
  };
}

/**
 * `AuthService` (BE-AUTH-01..05) — orchestrates the four endpoints of the
 * MVP authentication loop: signup, login, refresh, logout. Single source
 * of truth for the business rules that the spec calls out:
 *
 *   - Password ≥ 12 chars (`AUTH_WEAK_PASSWORD`, 422).
 *   - Duplicate email (`AUTH_EMAIL_TAKEN`, 409) — checked before hashing
 *     to avoid burning a slow argon2 round on a guaranteed-reject path.
 *   - Constant-time response on bad credentials (`AUTH_INVALID_CREDENTIALS`,
 *     401) — verify the password even when the user does not exist, so
 *     the response time does not reveal email enumeration.
 *   - MFA gating on login — if `mfa.enabled = true`, the access/refresh
 *     pair is withheld; the client receives an `mfaChallengeToken` that
 *     it must exchange.
 *   - Refresh rotation + reuse detection — delegated to
 *     `RefreshTokenService.rotate`, which emits
 *     `auth.refresh_token_reuse_detected` and revokes the family on
 *     replay.
 *
 * Audit side-effects (`auth.signup`, `auth.login_success`,
 * `auth.login_failed`, `auth.mfa_challenge_issued`, `auth.logout`) are
 * appended through `AuthEventsService` which swallows journal failures
 * — a flaky `auth_events` table must never brick the auth surface.
 *
 * `organizations: []` on login is a placeholder until BE-ORG-* lands —
 * see the type docstring above.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly mfa: MfaConfigRepository,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtTokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly audit: AuthEventsService,
    private readonly memberships: MembershipRepository,
    private readonly roles: RoleRepository,
    private readonly mfaService: MfaService,
  ) {}

  async signup(input: SignupInput, context: RequestContext): Promise<SignupResult> {
    if (input.password.length < PASSWORD_MIN_LENGTH) {
      throw new AppException(ERROR_CODES.AUTH_WEAK_PASSWORD, {
        message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
        details: { field: 'password', minLength: PASSWORD_MIN_LENGTH },
      });
    }

    if (await this.users.emailExists(input.email)) {
      throw new AppException(ERROR_CODES.AUTH_EMAIL_TAKEN, {
        message: 'Email already registered',
        details: { field: 'email' },
      });
    }

    const passwordHash = await this.passwords.hashPassword(input.password);
    const created = await this.users.create({
      email: input.email,
      passwordHash,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
    });

    await this.audit.record(
      'auth.signup',
      {
        userId: created.id,
        organizationId: null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      { email: created.email },
    );

    return { user: this.toPublicUser(created) };
  }

  async login(input: LoginInput, context: RequestContext): Promise<LoginResult> {
    const user = await this.users.findActiveByEmail(input.email);

    // Constant-time path: verify against a known hash even when the user
    // does not exist. argon2.verify on a dummy hash takes ~same time as
    // on a real hash, so the response time does not leak whether the
    // email is registered.
    const passwordHashForVerify = user?.passwordHash ?? AuthService.DUMMY_HASH_FOR_TIMING;
    const credentialsOk = await this.passwords.verifyPassword(
      passwordHashForVerify,
      input.password,
    );

    if (user === null || !credentialsOk || !user.isActive) {
      await this.audit.record(
        'auth.login_failed',
        {
          userId: user?.id ?? null,
          organizationId: null,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        { email: input.email },
      );
      throw new AppException(ERROR_CODES.AUTH_INVALID_CREDENTIALS, {
        message: 'Invalid email or password',
      });
    }

    const mfaConfig = await this.mfa.findByUserId(user.id);
    if (mfaConfig !== null && mfaConfig.enabled) {
      const mfaChallengeToken = this.jwt.signMfaChallengeToken({ sub: user.id });
      await this.audit.record(
        'auth.mfa_challenge_issued',
        {
          userId: user.id,
          organizationId: null,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        {},
      );
      return { mfa_required: true, mfaChallengeToken };
    }

    const refreshTokenResult = await this.refreshTokens.issue({
      userId: user.id,
      organizationId: null,
    });
    const accessToken = this.jwt.signAccessToken({
      sub: user.id,
      mfaVerified: false,
    });

    await this.audit.record(
      'auth.login_success',
      {
        userId: user.id,
        organizationId: null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      {},
    );

    return {
      mfa_required: false,
      accessToken,
      refreshToken: refreshTokenResult.token,
      user: this.toPublicUser(user),
      organizations: await this.listOrganizationsForUser(user.id),
    };
  }

  /**
   * Lookup the active memberships for `userId` and project each into the
   * public summary `{ id, name, slug, role }` consumed by the login
   * response and (later) the org switcher.
   *
   * Rows pointing at a soft-deleted organization are skipped — the user
   * still has the membership row historically, but the tenant is no
   * longer addressable. Rows whose `role` relation failed to load (data
   * integrity bug) are also skipped defensively.
   */
  private async listOrganizationsForUser(
    userId: string,
  ): Promise<ReadonlyArray<{ id: string; name: string; role: string }>> {
    const rows = await this.memberships.listOrganizationsForUser(userId);
    const summaries: { id: string; name: string; role: string }[] = [];
    for (const row of rows) {
      if (
        row.organization === undefined ||
        row.role === undefined ||
        row.organization.deletedAt !== null
      ) {
        continue;
      }
      summaries.push({
        id: row.organization.id,
        name: row.organization.name,
        role: row.role.code,
      });
    }
    return summaries;
  }

  async refresh(presentedToken: string, context: RequestContext): Promise<RefreshResult> {
    const rotated = await this.refreshTokens.rotate(presentedToken, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    // After rotation, re-issue an access token with the same scope as the
    // refresh row (`org_id` carried over from the rotation). `role` is
    // intentionally not re-resolved here — BE-AUTH-03
    // (select-organization) and the membership-aware refresh path will
    // refine the claim set in a follow-up.
    const accessToken = this.jwt.signAccessToken({
      sub: rotated.userId,
      ...(rotated.organizationId !== null ? { orgId: rotated.organizationId } : {}),
      mfaVerified: false,
    });

    return { accessToken, refreshToken: rotated.token };
  }

  async logout(presentedToken: string, context: RequestContext): Promise<void> {
    await this.refreshTokens.revoke(presentedToken);
    await this.audit.record(
      'auth.logout',
      {
        userId: null,
        organizationId: null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      {},
    );
  }

  /**
   * `POST /auth/login/mfa` — consumes the short-lived `mfaChallengeToken`
   * emitted by `login()` when the user has MFA enabled, plus a 6-digit
   * TOTP code (or an 8-char backup code). On success, issues the full
   * access + refresh token pair (same shape as a no-MFA login).
   *
   * The challenge token's purpose is enforced by
   * `JwtTokenService.verifyMfaChallengeToken` — an access token replayed
   * as a challenge throws `AUTH_INVALID_TOKEN` upstream, so we never get
   * here with the wrong purpose. The TOTP / backup code verification is
   * delegated to `MfaService.verifyLoginChallenge`, which also writes
   * `auth.mfa_verification_failed` on bad codes (we don't double-audit
   * here).
   */
  async completeMfaLogin(
    mfaChallengeToken: string,
    code: string,
    context: RequestContext,
  ): Promise<Exclude<LoginResult, { mfa_required: true }>> {
    const claims = this.jwt.verifyMfaChallengeToken(mfaChallengeToken);

    const user = await this.users.findActiveById(claims.sub);
    if (user === null || !user.isActive) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Invalid token',
      });
    }

    await this.mfaService.verifyLoginChallenge(claims.sub, code, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const refreshTokenResult = await this.refreshTokens.issue({
      userId: claims.sub,
      organizationId: null,
    });
    const accessToken = this.jwt.signAccessToken({
      sub: claims.sub,
      mfaVerified: true,
    });

    await this.audit.record(
      'auth.login_success',
      {
        userId: claims.sub,
        organizationId: null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      { mfaVerified: true },
    );

    return {
      mfa_required: false,
      accessToken,
      refreshToken: refreshTokenResult.token,
      user: this.toPublicUser(user),
      organizations: await this.listOrganizationsForUser(user.id),
    };
  }

  /**
   * `POST /auth/select-organization` — upgrades a freshly-authenticated
   * session (access token with no `org_id` claim) to a tenant-scoped one.
   *
   * Flow:
   *   1. Lookup the active membership for (userId, orgId). Absence →
   *      ORG_NOT_FOUND (404, never 403) so the response can't be used to
   *      enumerate organizations the caller has no relation to. Emits
   *      `auth.cross_tenant_attempt` so an admin can correlate the
   *      attempt with the originating IP / user-agent.
   *   2. Resolve the role code from `roles` (membership stores `role_id`,
   *      the JWT claim wants the human-readable `code`). Same 404 on a
   *      missing role row (data-integrity bug — FK RESTRICT should
   *      prevent it).
   *   3. Sign a fresh access token carrying `org_id` + `role` claims, and
   *      a fresh refresh token scoped to the org. The old refresh
   *      survives until natural expiry; killing it here would force the
   *      browser/CLI to keep two refresh tokens in flight (we may revisit
   *      once a "switch organization" UX exists).
   *
   * `mfa_verified` is intentionally left `false` on the new access token:
   *  selecting an org is not an MFA-binding step. A future MFA-aware path
   *  (BE-AUTH-MFA-VERIFIED) will mint MFA-aware tokens through a
   *  dedicated flow.
   */
  async selectOrganization(
    userId: string,
    targetOrgId: string,
    context: RequestContext,
  ): Promise<SelectOrganizationResult> {
    const membership = await this.memberships.findActiveByUserAndOrganizationWithOrg(
      userId,
      targetOrgId,
    );

    if (membership === null) {
      await this.audit.record(
        'auth.cross_tenant_attempt',
        {
          userId,
          organizationId: targetOrgId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        { attemptedOrgId: targetOrgId, via: 'select-organization' },
      );
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Organization not found',
      });
    }

    const role = await this.roles.findById(membership.roleId);
    const organization = membership.organization;
    if (role === null || organization === undefined || organization.deletedAt !== null) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Organization not found',
      });
    }

    const refreshTokenResult = await this.refreshTokens.issue({
      userId,
      organizationId: targetOrgId,
    });
    const accessToken = this.jwt.signAccessToken({
      sub: userId,
      orgId: targetOrgId,
      role: role.code,
      mfaVerified: false,
    });

    return {
      accessToken,
      refreshToken: refreshTokenResult.token,
      organization: {
        id: organization.id,
        name: organization.name,
        role: role.code,
      },
    };
  }

  private toPublicUser(user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  }): PublicUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }

  /**
   * Pre-computed argon2id hash of a fixed random string. Used as a
   * "dummy" verify target on the unknown-email path so the login
   * response time is independent of whether the email is registered.
   *
   * Regenerated locally via:
   *   `node -e "require('argon2').hash('not-a-real-password', { type: require('argon2').argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }).then(console.log)"`
   *
   * The plaintext is never a valid password (it's a sentinel), so
   * `argon2.verify(this hash, anyUserInput)` returns `false` with the
   * same CPU cost as a real verification.
   */
  private static readonly DUMMY_HASH_FOR_TIMING =
    '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$ozueXKqe3Q3K3CmqSbpC3SrYWf1ZMHsTQJ9SgDB6w0o';
}
