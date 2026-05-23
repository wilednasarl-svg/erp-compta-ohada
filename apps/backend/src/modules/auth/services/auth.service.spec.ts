import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { AuthEventContext, AuthEventsService } from '../../audit/services/auth-events.service';
import type { AuthEventEntity } from '../../audit/entities/auth-event.entity';
import type { MfaConfigEntity } from '../entities/mfa-config.entity';
import type { UserEntity } from '../entities/user.entity';
import type { MfaConfigRepository } from '../repositories/mfa-config.repository';
import type { UserRepository } from '../repositories/user.repository';
import { AuthService, type RequestContext } from './auth.service';
import type {
  IssuedRefreshToken,
  IssueRefreshTokenInput,
  RefreshTokenService,
  RotateContext,
} from './refresh-token.service';
import type {
  JwtTokenService,
  SignAccessTokenInput,
  SignMfaChallengeTokenInput,
} from './jwt-token.service';
import type { PasswordService } from './password.service';

const CTX: RequestContext = { ipAddress: '203.0.113.1', userAgent: 'jest/1.0' };

function buildUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 'user-1',
    email: 'a@b.ci',
    passwordHash: 'stored-hash',
    firstName: 'Yao',
    lastName: 'Konan',
    locale: 'fr-FR',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as UserEntity;
}

interface Harness {
  service: AuthService;
  findActiveByEmail: jest.Mock<Promise<UserEntity | null>, [string]>;
  emailExists: jest.Mock<Promise<boolean>, [string]>;
  createUser: jest.Mock<
    Promise<UserEntity>,
    [
      {
        email: string;
        passwordHash: string;
        firstName?: string | null;
        lastName?: string | null;
        locale?: string;
      },
    ]
  >;
  findMfaByUserId: jest.Mock<Promise<MfaConfigEntity | null>, [string]>;
  hashPassword: jest.Mock<Promise<string>, [string]>;
  verifyPassword: jest.Mock<Promise<boolean>, [string, string]>;
  signAccessToken: jest.Mock<string, [SignAccessTokenInput]>;
  signMfaChallengeToken: jest.Mock<string, [SignMfaChallengeTokenInput]>;
  issueRefresh: jest.Mock<Promise<IssuedRefreshToken>, [IssueRefreshTokenInput]>;
  rotateRefresh: jest.Mock<Promise<IssuedRefreshToken>, [string, RotateContext?]>;
  revokeRefresh: jest.Mock<Promise<void>, [string]>;
  recordEvent: jest.Mock<
    Promise<AuthEventEntity | null>,
    [string, AuthEventContext, Record<string, unknown>?]
  >;
}

function buildHarness(): Harness {
  const findActiveByEmail = jest.fn<Promise<UserEntity | null>, [string]>();
  const emailExists = jest.fn<Promise<boolean>, [string]>();
  const createUser = jest.fn<
    Promise<UserEntity>,
    [
      {
        email: string;
        passwordHash: string;
        firstName?: string | null;
        lastName?: string | null;
        locale?: string;
      },
    ]
  >();
  const findMfaByUserId = jest
    .fn<Promise<MfaConfigEntity | null>, [string]>()
    .mockResolvedValue(null);
  const hashPassword = jest.fn<Promise<string>, [string]>().mockResolvedValue('argon2-hash');
  const verifyPassword = jest.fn<Promise<boolean>, [string, string]>().mockResolvedValue(true);
  const signAccessToken = jest.fn<string, [SignAccessTokenInput]>().mockReturnValue('access.jwt');
  const signMfaChallengeToken = jest
    .fn<string, [SignMfaChallengeTokenInput]>()
    .mockReturnValue('mfa.jwt');
  const issueRefresh = jest.fn<Promise<IssuedRefreshToken>, [IssueRefreshTokenInput]>();
  const rotateRefresh = jest.fn<Promise<IssuedRefreshToken>, [string, RotateContext?]>();
  const revokeRefresh = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
  const recordEvent = jest
    .fn<Promise<AuthEventEntity | null>, [string, AuthEventContext, Record<string, unknown>?]>()
    .mockResolvedValue(null);

  const users = {
    findActiveByEmail,
    findActiveById: jest.fn(),
    emailExists,
    create: createUser,
    updatePasswordHash: jest.fn(),
    setActive: jest.fn(),
    softDelete: jest.fn(),
  } as unknown as UserRepository;

  const mfa = { findByUserId: findMfaByUserId } as unknown as MfaConfigRepository;
  const passwords = { hashPassword, verifyPassword } as unknown as PasswordService;
  const jwt = { signAccessToken, signMfaChallengeToken } as unknown as JwtTokenService;
  const refresh = {
    issue: issueRefresh,
    rotate: rotateRefresh,
    revoke: revokeRefresh,
  } as unknown as RefreshTokenService;
  const audit = { record: recordEvent } as unknown as AuthEventsService;

  const service = new AuthService(users, mfa, passwords, jwt, refresh, audit);

  return {
    service,
    findActiveByEmail,
    emailExists,
    createUser,
    findMfaByUserId,
    hashPassword,
    verifyPassword,
    signAccessToken,
    signMfaChallengeToken,
    issueRefresh,
    rotateRefresh,
    revokeRefresh,
    recordEvent,
  };
}

describe('AuthService (BE-AUTH-01..05)', () => {
  describe('signup', () => {
    it('rejects a password shorter than 12 chars with AUTH_WEAK_PASSWORD / 422', async () => {
      const h = buildHarness();
      await expect(
        h.service.signup({ email: 'a@b.ci', password: 'short' }, CTX),
      ).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_WEAK_PASSWORD,
        status: 422,
      });
      expect(h.hashPassword).not.toHaveBeenCalled();
      expect(h.emailExists).not.toHaveBeenCalled();
    });

    it('rejects a duplicate email with AUTH_EMAIL_TAKEN / 409 BEFORE running argon2', async () => {
      const h = buildHarness();
      h.emailExists.mockResolvedValue(true);

      await expect(
        h.service.signup({ email: 'a@b.ci', password: 'StrongPassw0rd!' }, CTX),
      ).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_EMAIL_TAKEN,
        status: 409,
      });
      // Critical: argon2 is slow; we must not burn a hash on a guaranteed-reject
      // path. The order check is part of the BE-AUTH-01 spec rationale.
      expect(h.hashPassword).not.toHaveBeenCalled();
    });

    it('hashes the password, persists the user, and emits auth.signup on the happy path', async () => {
      const h = buildHarness();
      h.emailExists.mockResolvedValue(false);
      h.createUser.mockResolvedValue(buildUser({ id: 'u-99' }));

      const result = await h.service.signup(
        { email: 'a@b.ci', password: 'StrongPassw0rd!', firstName: 'Yao' },
        CTX,
      );

      expect(h.hashPassword).toHaveBeenCalledWith('StrongPassw0rd!');
      const created = h.createUser.mock.calls[0][0];
      expect(created.email).toBe('a@b.ci');
      expect(created.passwordHash).toBe('argon2-hash');
      expect(created.firstName).toBe('Yao');
      expect(created.lastName).toBeNull();

      expect(h.recordEvent).toHaveBeenCalledTimes(1);
      const [eventType, ctx, meta] = h.recordEvent.mock.calls[0];
      expect(eventType).toBe('auth.signup');
      expect(ctx.userId).toBe('u-99');
      expect(ctx.ipAddress).toBe('203.0.113.1');
      expect(meta).toMatchObject({ email: 'a@b.ci' });

      expect(result).toEqual({
        user: {
          id: 'u-99',
          email: 'a@b.ci',
          firstName: 'Yao',
          lastName: 'Konan',
        },
      });
    });
  });

  describe('login', () => {
    it('returns access+refresh on a valid credential pair with no MFA', async () => {
      const h = buildHarness();
      const user = buildUser({ id: 'u-1' });
      h.findActiveByEmail.mockResolvedValue(user);
      h.findMfaByUserId.mockResolvedValue(null);
      h.issueRefresh.mockResolvedValue({
        token: 'rt-plain',
        familyId: 'fam-1',
        expiresAt: new Date(),
        userId: 'u-1',
        organizationId: null,
      } satisfies IssuedRefreshToken);

      const result = await h.service.login({ email: 'a@b.ci', password: 'StrongPassw0rd!' }, CTX);

      expect(result).toMatchObject({
        mfa_required: false,
        accessToken: 'access.jwt',
        refreshToken: 'rt-plain',
        organizations: [],
      });
      expect(h.signAccessToken).toHaveBeenCalledWith({ sub: 'u-1', mfaVerified: false });
      expect(h.recordEvent).toHaveBeenCalledTimes(1);
      expect(h.recordEvent.mock.calls[0][0]).toBe('auth.login_success');
    });

    it('returns mfa_required + a challenge token when the user has MFA enabled', async () => {
      const h = buildHarness();
      h.findActiveByEmail.mockResolvedValue(buildUser({ id: 'u-mfa' }));
      h.findMfaByUserId.mockResolvedValue({
        userId: 'u-mfa',
        enabled: true,
      } as MfaConfigEntity);

      const result = await h.service.login({ email: 'a@b.ci', password: 'StrongPassw0rd!' }, CTX);

      expect(result).toEqual({ mfa_required: true, mfaChallengeToken: 'mfa.jwt' });
      expect(h.signMfaChallengeToken).toHaveBeenCalledWith({ sub: 'u-mfa' });
      expect(h.issueRefresh).not.toHaveBeenCalled();
      expect(h.signAccessToken).not.toHaveBeenCalled();
      expect(h.recordEvent.mock.calls[0][0]).toBe('auth.mfa_challenge_issued');
    });

    it('throws AUTH_INVALID_CREDENTIALS and emits auth.login_failed on a wrong password', async () => {
      const h = buildHarness();
      h.findActiveByEmail.mockResolvedValue(buildUser({ id: 'u-1' }));
      h.verifyPassword.mockResolvedValue(false);

      await expect(
        h.service.login({ email: 'a@b.ci', password: 'wrong-but-long-enough' }, CTX),
      ).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        status: 401,
      });
      expect(h.recordEvent.mock.calls[0][0]).toBe('auth.login_failed');
      expect(h.recordEvent.mock.calls[0][1]).toMatchObject({ userId: 'u-1' });
    });

    it('runs verifyPassword even when the email is unknown (constant-time response)', async () => {
      const h = buildHarness();
      h.findActiveByEmail.mockResolvedValue(null);

      await expect(
        h.service.login({ email: 'ghost@b.ci', password: 'some-password-here' }, CTX),
      ).rejects.toBeInstanceOf(AppException);

      // Critical: argon2.verify MUST run on the unknown-email branch too,
      // otherwise the request finishes much faster than for a known email,
      // leaking enumeration. The dummy hash lives on AuthService statically.
      expect(h.verifyPassword).toHaveBeenCalledTimes(1);
      const [hashArg, plainArg] = h.verifyPassword.mock.calls[0];
      expect(typeof hashArg).toBe('string');
      expect(hashArg).toMatch(/^\$argon2id\$/);
      expect(plainArg).toBe('some-password-here');

      // login_failed is still journaled with userId=null on the unknown
      // path so an attacker pattern can be correlated by IP + email.
      expect(h.recordEvent.mock.calls[0][0]).toBe('auth.login_failed');
      expect(h.recordEvent.mock.calls[0][1]).toMatchObject({ userId: null });
    });

    it('rejects an inactive user with AUTH_INVALID_CREDENTIALS (no info leak about suspension)', async () => {
      const h = buildHarness();
      h.findActiveByEmail.mockResolvedValue(buildUser({ isActive: false }));

      await expect(
        h.service.login({ email: 'a@b.ci', password: 'StrongPassw0rd!' }, CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.AUTH_INVALID_CREDENTIALS });
    });
  });

  describe('refresh', () => {
    it('rotates and re-signs an access token carrying the org_id of the consumed token', async () => {
      const h = buildHarness();
      h.rotateRefresh.mockResolvedValue({
        token: 'rt-new',
        familyId: 'fam-1',
        expiresAt: new Date(),
        userId: 'u-1',
        organizationId: 'org-7',
      } satisfies IssuedRefreshToken);

      const result = await h.service.refresh('rt-old', CTX);

      expect(h.rotateRefresh).toHaveBeenCalledWith('rt-old', {
        ipAddress: '203.0.113.1',
        userAgent: 'jest/1.0',
      });
      expect(h.signAccessToken).toHaveBeenCalledWith({
        sub: 'u-1',
        orgId: 'org-7',
        mfaVerified: false,
      });
      expect(result).toEqual({ accessToken: 'access.jwt', refreshToken: 'rt-new' });
    });

    it('omits orgId in the access token claims when the rotated refresh had no org', async () => {
      const h = buildHarness();
      h.rotateRefresh.mockResolvedValue({
        token: 'rt-new',
        familyId: 'fam-1',
        expiresAt: new Date(),
        userId: 'u-1',
        organizationId: null,
      } satisfies IssuedRefreshToken);

      await h.service.refresh('rt-old', CTX);

      const claims = h.signAccessToken.mock.calls[0][0];
      expect('orgId' in claims).toBe(false);
    });

    it('lets reuse-detection failures from RefreshTokenService propagate untouched', async () => {
      const h = buildHarness();
      h.rotateRefresh.mockRejectedValue(new AppException(ERROR_CODES.AUTH_REFRESH_REUSE));

      await expect(h.service.refresh('replayed', CTX)).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_REFRESH_REUSE,
      });
    });
  });

  describe('logout', () => {
    it('revokes the presented refresh token and emits auth.logout', async () => {
      const h = buildHarness();

      await h.service.logout('rt-x', CTX);

      expect(h.revokeRefresh).toHaveBeenCalledWith('rt-x');
      expect(h.recordEvent).toHaveBeenCalledTimes(1);
      expect(h.recordEvent.mock.calls[0][0]).toBe('auth.logout');
    });
  });
});
