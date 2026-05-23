import { createHash } from 'node:crypto';

import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { Clock } from '../../../common/time/clock';
import type { AuthEventContext, AuthEventsService } from '../../audit/services/auth-events.service';
import type { AuthEventEntity } from '../../audit/entities/auth-event.entity';
import type { UserEntity } from '../../auth/entities/user.entity';
import type { UserRepository } from '../../auth/repositories/user.repository';
import type { InvitationTokenClaims } from '../../auth/config/jwt.config';
import type {
  JwtTokenService,
  SignInvitationTokenInput,
} from '../../auth/services/jwt-token.service';
import type { PasswordService } from '../../auth/services/password.service';
import type { EmailService, InvitationEmailInput } from '../../email/services/email.service';
import type { MembershipEntity } from '../../rbac/entities/membership.entity';
import type { RoleEntity } from '../../rbac/entities/role.entity';
import type { MembershipRepository } from '../../rbac/repositories/membership.repository';
import type { RoleRepository } from '../../rbac/repositories/role.repository';
import type { InvitationEntity } from '../entities/invitation.entity';
import type { OrganizationEntity } from '../entities/organization.entity';
import type { InvitationRepository } from '../repositories/invitation.repository';
import type { OrganizationRepository } from '../repositories/organization.repository';
import { InvitationsService } from './invitations.service';

const T0 = 1_700_000_000_000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CTX: AuthEventContext = { ipAddress: '203.0.113.1', userAgent: 'jest/1.0' };

function buildClock(epochMs: number): Clock {
  return { now: () => new Date(epochMs), nowMs: () => epochMs };
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function buildOrg(overrides: Partial<OrganizationEntity> = {}): OrganizationEntity {
  return {
    id: 'org-1',
    name: 'Cabinet Konan',
    slug: 'cabinet-konan',
    type: 'firm',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as OrganizationEntity;
}

function buildRole(code: string, id: string = `role-${code}`): RoleEntity {
  return { id, code, name: code, description: null, isSystem: true } as RoleEntity;
}

function buildInvitation(overrides: Partial<InvitationEntity> = {}): InvitationEntity {
  return {
    id: 'inv-1',
    organizationId: 'org-1',
    email: 'new@cabinet.ci',
    roleId: 'role-comptable',
    tokenHash: 'placeholder',
    status: 'pending',
    invitedBy: 'admin-1',
    expiresAt: new Date(T0 + SEVEN_DAYS_MS),
    acceptedAt: null,
    createdAt: new Date(T0),
    updatedAt: new Date(T0),
    ...overrides,
  } as InvitationEntity;
}

function buildUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 'user-1',
    email: 'a@b.ci',
    passwordHash: 'h',
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
  service: InvitationsService;
  findInvitationById: jest.Mock<Promise<InvitationEntity | null>, [string, string]>;
  findPendingByEmail: jest.Mock<Promise<InvitationEntity | null>, [string, string]>;
  listByStatus: jest.Mock<Promise<InvitationEntity[]>, [string, InvitationEntity['status']]>;
  createInvitationRow: jest.Mock<Promise<InvitationEntity>, [string, unknown]>;
  updateTokenHash: jest.Mock<Promise<void>, [string, string, string]>;
  markAccepted: jest.Mock<Promise<void>, [string, string, Date]>;
  markRevoked: jest.Mock<Promise<void>, [string, string]>;
  markExpired: jest.Mock<Promise<void>, [string, string]>;
  findOrgActiveById: jest.Mock<Promise<OrganizationEntity | null>, [string]>;
  findRoleById: jest.Mock<Promise<RoleEntity | null>, [string]>;
  findRoleByCode: jest.Mock<Promise<RoleEntity | null>, [string]>;
  findMembershipByUserAndOrg: jest.Mock<Promise<MembershipEntity | null>, [string, string]>;
  createMembership: jest.Mock<Promise<MembershipEntity>, [unknown]>;
  findUserByEmail: jest.Mock<Promise<UserEntity | null>, [string]>;
  findUserById: jest.Mock<Promise<UserEntity | null>, [string]>;
  createUser: jest.Mock<Promise<UserEntity>, [unknown]>;
  hashPassword: jest.Mock<Promise<string>, [string]>;
  signInvitationToken: jest.Mock<string, [SignInvitationTokenInput]>;
  verifyInvitationToken: jest.Mock<InvitationTokenClaims, [string]>;
  recordEvent: jest.Mock<
    Promise<AuthEventEntity | null>,
    [string, AuthEventContext, Record<string, unknown>?]
  >;
  sendInvitationEmail: jest.Mock<Promise<void>, [InvitationEmailInput]>;
  buildAcceptUrl: jest.Mock<string, [string]>;
}

function buildHarness(epochMs: number = T0): Harness {
  const findInvitationById = jest.fn<Promise<InvitationEntity | null>, [string, string]>();
  const findPendingByEmail = jest.fn<Promise<InvitationEntity | null>, [string, string]>();
  const listByStatus = jest.fn<Promise<InvitationEntity[]>, [string, InvitationEntity['status']]>();
  const createInvitationRow = jest.fn<Promise<InvitationEntity>, [string, unknown]>();
  const updateTokenHash = jest
    .fn<Promise<void>, [string, string, string]>()
    .mockResolvedValue(undefined);
  const markAccepted = jest
    .fn<Promise<void>, [string, string, Date]>()
    .mockResolvedValue(undefined);
  const markRevoked = jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined);
  const markExpired = jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined);

  const findOrgActiveById = jest.fn<Promise<OrganizationEntity | null>, [string]>();
  const findRoleById = jest.fn<Promise<RoleEntity | null>, [string]>();
  const findRoleByCode = jest.fn<Promise<RoleEntity | null>, [string]>();
  const findMembershipByUserAndOrg = jest
    .fn<Promise<MembershipEntity | null>, [string, string]>()
    .mockResolvedValue(null);
  const createMembership = jest.fn<Promise<MembershipEntity>, [unknown]>();

  const findUserByEmail = jest.fn<Promise<UserEntity | null>, [string]>();
  const findUserById = jest.fn<Promise<UserEntity | null>, [string]>();
  const createUser = jest.fn<Promise<UserEntity>, [unknown]>();
  const hashPassword = jest.fn<Promise<string>, [string]>().mockResolvedValue('argon2-hash');

  const signInvitationToken = jest
    .fn<string, [SignInvitationTokenInput]>()
    .mockReturnValue('signed.invitation.jwt');
  const verifyInvitationToken = jest.fn<InvitationTokenClaims, [string]>();

  const recordEvent = jest
    .fn<Promise<AuthEventEntity | null>, [string, AuthEventContext, Record<string, unknown>?]>()
    .mockResolvedValue(null);

  const sendInvitationEmail = jest
    .fn<Promise<void>, [InvitationEmailInput]>()
    .mockResolvedValue(undefined);
  const buildAcceptUrl = jest
    .fn<string, [string]>()
    .mockImplementation((token) => `https://app.example/accept-invitation?token=${token}`);

  const invitationsRepo = {
    findById: findInvitationById,
    findPendingByEmail,
    listByStatus,
    findActiveByTokenHash: jest.fn(),
    create: createInvitationRow,
    updateTokenHash,
    markAccepted,
    markRevoked,
    markExpired,
  } as unknown as InvitationRepository;

  const organizationsRepo = {
    findActiveById: findOrgActiveById,
  } as unknown as OrganizationRepository;

  const membershipsRepo = {
    findByUserAndOrganization: findMembershipByUserAndOrg,
    create: createMembership,
  } as unknown as MembershipRepository;

  const rolesRepo = {
    findById: findRoleById,
    findByCode: findRoleByCode,
  } as unknown as RoleRepository;

  const usersRepo = {
    findActiveByEmail: findUserByEmail,
    findActiveById: findUserById,
    create: createUser,
  } as unknown as UserRepository;

  const passwords = { hashPassword } as unknown as PasswordService;
  const jwt = { signInvitationToken, verifyInvitationToken } as unknown as JwtTokenService;
  const audit = { record: recordEvent } as unknown as AuthEventsService;
  const email = {
    sendInvitationEmail,
    buildAcceptInvitationUrl: buildAcceptUrl,
  } as unknown as EmailService;

  const service = new InvitationsService(
    buildClock(epochMs),
    invitationsRepo,
    organizationsRepo,
    membershipsRepo,
    rolesRepo,
    usersRepo,
    passwords,
    jwt,
    audit,
    email,
  );

  return {
    service,
    findInvitationById,
    findPendingByEmail,
    listByStatus,
    createInvitationRow,
    updateTokenHash,
    markAccepted,
    markRevoked,
    markExpired,
    findOrgActiveById,
    findRoleById,
    findRoleByCode,
    findMembershipByUserAndOrg,
    createMembership,
    findUserByEmail,
    findUserById,
    createUser,
    hashPassword,
    signInvitationToken,
    verifyInvitationToken,
    recordEvent,
    sendInvitationEmail,
    buildAcceptUrl,
  };
}

describe('InvitationsService (BE-INV-01..03)', () => {
  describe('create', () => {
    it('rejects with ORG_NOT_FOUND when the org row is missing', async () => {
      const h = buildHarness();
      h.findOrgActiveById.mockResolvedValue(null);
      h.findRoleByCode.mockResolvedValue(buildRole('comptable'));

      await expect(
        h.service.create('admin-1', 'org-x', { email: 'new@x.ci', roleCode: 'comptable' }, CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.ORG_NOT_FOUND });
    });

    it('rejects with INVITATION_ALREADY_PENDING on duplicate pending invitation', async () => {
      const h = buildHarness();
      h.findOrgActiveById.mockResolvedValue(buildOrg());
      h.findRoleByCode.mockResolvedValue(buildRole('comptable'));
      h.findPendingByEmail.mockResolvedValue(buildInvitation({ id: 'inv-existing' }));

      await expect(
        h.service.create(
          'admin-1',
          'org-1',
          { email: 'new@cabinet.ci', roleCode: 'comptable' },
          CTX,
        ),
      ).rejects.toMatchObject({
        code: ERROR_CODES.INVITATION_ALREADY_PENDING,
        details: { invitationId: 'inv-existing' },
      });
    });

    it('persists with the right expiry, signs the JWT with stable invitation_id, patches token_hash, and emails the invitee', async () => {
      const h = buildHarness();
      h.findOrgActiveById.mockResolvedValue(buildOrg({ name: 'Cabinet Konan' }));
      h.findRoleByCode.mockResolvedValue(buildRole('comptable', 'role-comptable'));
      h.findPendingByEmail.mockResolvedValue(null);
      h.createInvitationRow.mockResolvedValue(buildInvitation({ id: 'inv-fresh' }));
      h.findUserById.mockResolvedValue(
        buildUser({ id: 'admin-1', firstName: 'Yao', lastName: 'Konan' }),
      );

      const result = await h.service.create(
        'admin-1',
        'org-1',
        { email: 'new@cabinet.ci', roleCode: 'comptable' },
        CTX,
      );

      // 1. row inserted with the 7d expiry computed off the injected clock
      expect(h.createInvitationRow).toHaveBeenCalledTimes(1);
      const persistArgs = h.createInvitationRow.mock.calls[0];
      expect(persistArgs[0]).toBe('org-1');
      expect((persistArgs[1] as { expiresAt: Date }).expiresAt.getTime()).toBe(T0 + SEVEN_DAYS_MS);

      // 2. JWT signed with the stable invitation id
      expect(h.signInvitationToken).toHaveBeenCalledWith({
        sub: 'admin-1',
        invitationId: 'inv-fresh',
        orgId: 'org-1',
        email: 'new@cabinet.ci',
        roleId: 'role-comptable',
      });

      // 3. token_hash patched with the actual JWT hash
      expect(h.updateTokenHash).toHaveBeenCalledWith(
        'inv-fresh',
        'org-1',
        hash('signed.invitation.jwt'),
      );

      // 4. email sent with the accept URL and inviter display name
      expect(h.sendInvitationEmail).toHaveBeenCalledTimes(1);
      const emailArg = h.sendInvitationEmail.mock.calls[0][0];
      expect(emailArg.to).toBe('new@cabinet.ci');
      expect(emailArg.organizationName).toBe('Cabinet Konan');
      expect(emailArg.inviterName).toBe('Yao Konan');
      expect(emailArg.acceptUrl).toBe(
        'https://app.example/accept-invitation?token=signed.invitation.jwt',
      );

      // 5. audit event
      expect(h.recordEvent).toHaveBeenCalledTimes(1);
      expect(h.recordEvent.mock.calls[0][0]).toBe('organizations.invitation_sent');

      expect(result.invitation.id).toBe('inv-fresh');
      expect(result.invitation.roleCode).toBe('comptable');
      expect(result.invitation.status).toBe('pending');
    });
  });

  describe('revoke', () => {
    it('marks a pending invitation revoked + audits', async () => {
      const h = buildHarness();
      h.findInvitationById.mockResolvedValue(buildInvitation({ status: 'pending' }));

      await h.service.revoke('admin-1', 'org-1', 'inv-1', CTX);

      expect(h.markRevoked).toHaveBeenCalledWith('inv-1', 'org-1');
      expect(h.recordEvent).toHaveBeenCalledTimes(1);
    });

    it('rejects with INVITATION_NOT_FOUND when the row is missing', async () => {
      const h = buildHarness();
      h.findInvitationById.mockResolvedValue(null);

      await expect(h.service.revoke('admin-1', 'org-1', 'inv-x', CTX)).rejects.toMatchObject({
        code: ERROR_CODES.INVITATION_NOT_FOUND,
      });
    });

    it('is a no-op (no write, no audit) on already-final invitations', async () => {
      const h = buildHarness();
      h.findInvitationById.mockResolvedValue(buildInvitation({ status: 'accepted' }));

      await h.service.revoke('admin-1', 'org-1', 'inv-1', CTX);

      expect(h.markRevoked).not.toHaveBeenCalled();
      expect(h.recordEvent).not.toHaveBeenCalled();
    });
  });

  describe('accept', () => {
    function withClaims(
      h: Harness,
      overrides: Partial<InvitationTokenClaims> = {},
    ): InvitationTokenClaims {
      const claims: InvitationTokenClaims = {
        sub: 'admin-1',
        purpose: 'invitation',
        org_id: 'org-1',
        email: 'new@cabinet.ci',
        role_id: 'role-comptable',
        invitation_id: 'inv-1',
        iat: Math.floor(T0 / 1000),
        exp: Math.floor((T0 + SEVEN_DAYS_MS) / 1000),
        iss: 'erp-compta-auth',
        ...overrides,
      };
      h.verifyInvitationToken.mockReturnValue(claims);
      return claims;
    }

    it('happy path — existing user: creates membership, marks accepted, emits organizations.invitation_accepted, returns userCreated=false', async () => {
      const h = buildHarness();
      withClaims(h);
      const tokenHash = hash('the.token');
      h.findInvitationById.mockResolvedValue(buildInvitation({ tokenHash }));
      h.findOrgActiveById.mockResolvedValue(buildOrg());
      h.findRoleById.mockResolvedValue(buildRole('comptable'));
      h.findUserByEmail.mockResolvedValue(buildUser({ id: 'u-existing', email: 'new@cabinet.ci' }));
      h.findMembershipByUserAndOrg.mockResolvedValue(null);
      h.createMembership.mockResolvedValue({
        id: 'm-new',
        roleId: 'role-comptable',
      } as MembershipEntity);

      const result = await h.service.accept({ token: 'the.token' }, CTX);

      expect(h.createUser).not.toHaveBeenCalled();
      expect(h.createMembership).toHaveBeenCalledTimes(1);
      expect(h.markAccepted).toHaveBeenCalledWith('inv-1', 'org-1', new Date(T0));
      expect(h.recordEvent.mock.calls.map((c) => c[0])).toContain(
        'organizations.invitation_accepted',
      );
      expect(result.userCreated).toBe(false);
      expect(result.user.id).toBe('u-existing');
      expect(result.membership.role).toBe('comptable');
    });

    it('happy path — new user: hashes password, creates user, emits auth.signup, returns userCreated=true', async () => {
      const h = buildHarness();
      withClaims(h);
      const tokenHash = hash('signup.token');
      h.findInvitationById.mockResolvedValue(buildInvitation({ tokenHash }));
      h.findOrgActiveById.mockResolvedValue(buildOrg());
      h.findRoleById.mockResolvedValue(buildRole('comptable'));
      h.findUserByEmail.mockResolvedValue(null);
      h.createUser.mockResolvedValue(buildUser({ id: 'u-new', email: 'new@cabinet.ci' }));
      h.createMembership.mockResolvedValue({
        id: 'm-new',
        roleId: 'role-comptable',
      } as MembershipEntity);

      const result = await h.service.accept(
        {
          token: 'signup.token',
          password: 'Str0ngPassw0rd!',
          firstName: 'Awa',
          lastName: 'Diabaté',
        },
        CTX,
      );

      expect(h.hashPassword).toHaveBeenCalledWith('Str0ngPassw0rd!');
      expect(h.createUser).toHaveBeenCalledTimes(1);
      const createArg = h.createUser.mock.calls[0][0] as { firstName: string | null };
      expect(createArg.firstName).toBe('Awa');

      expect(h.recordEvent.mock.calls.map((c) => c[0])).toContain('auth.signup');
      expect(h.recordEvent.mock.calls.map((c) => c[0])).toContain(
        'organizations.invitation_accepted',
      );
      expect(result.userCreated).toBe(true);
    });

    it('rejects with AUTH_WEAK_PASSWORD when the email is new and no password is provided', async () => {
      const h = buildHarness();
      withClaims(h);
      const tokenHash = hash('weak.token');
      h.findInvitationById.mockResolvedValue(buildInvitation({ tokenHash }));
      h.findOrgActiveById.mockResolvedValue(buildOrg());
      h.findRoleById.mockResolvedValue(buildRole('comptable'));
      h.findUserByEmail.mockResolvedValue(null);

      await expect(h.service.accept({ token: 'weak.token' }, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_WEAK_PASSWORD,
      });
      expect(h.createUser).not.toHaveBeenCalled();
    });

    it('rejects with INVITATION_EXPIRED when expiresAt has passed (clock-driven)', async () => {
      const h = buildHarness(T0);
      withClaims(h);
      const tokenHash = hash('expired.token');
      h.findInvitationById.mockResolvedValue(
        buildInvitation({ tokenHash, expiresAt: new Date(T0 - 1) }),
      );
      h.findOrgActiveById.mockResolvedValue(buildOrg());

      await expect(h.service.accept({ token: 'expired.token' }, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.INVITATION_EXPIRED,
      });
      // Side-effect: the row is flipped to `expired` so the next replay
      // hits the DB-side branch and short-circuits the clock check.
      expect(h.markExpired).toHaveBeenCalledWith('inv-1', 'org-1');
    });

    it('rejects with INVITATION_ALREADY_USED for an already-accepted invitation', async () => {
      const h = buildHarness();
      withClaims(h);
      const tokenHash = hash('used.token');
      h.findInvitationById.mockResolvedValue(buildInvitation({ status: 'accepted', tokenHash }));

      await expect(h.service.accept({ token: 'used.token' }, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.INVITATION_ALREADY_USED,
      });
    });

    it('rejects with INVITATION_REVOKED for a revoked invitation', async () => {
      const h = buildHarness();
      withClaims(h);
      const tokenHash = hash('revoked.token');
      h.findInvitationById.mockResolvedValue(buildInvitation({ status: 'revoked', tokenHash }));

      await expect(h.service.accept({ token: 'revoked.token' }, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.INVITATION_REVOKED,
      });
    });

    it('rejects with INVITATION_NOT_FOUND when the presented hash does not match the stored one', async () => {
      const h = buildHarness();
      withClaims(h);
      h.findInvitationById.mockResolvedValue(buildInvitation({ tokenHash: 'different-hash' }));

      await expect(h.service.accept({ token: 'mismatched.token' }, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.INVITATION_NOT_FOUND,
      });
    });

    it('rejects with INVITATION_ALREADY_USED when the user is already a member of the org', async () => {
      const h = buildHarness();
      withClaims(h);
      const tokenHash = hash('repeat.token');
      h.findInvitationById.mockResolvedValue(buildInvitation({ tokenHash }));
      h.findOrgActiveById.mockResolvedValue(buildOrg());
      h.findRoleById.mockResolvedValue(buildRole('comptable'));
      h.findUserByEmail.mockResolvedValue(buildUser({ id: 'u-existing', email: 'new@cabinet.ci' }));
      h.findMembershipByUserAndOrg.mockResolvedValue({ id: 'm-old' } as MembershipEntity);

      await expect(h.service.accept({ token: 'repeat.token' }, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.INVITATION_ALREADY_USED,
      });
      expect(h.createMembership).not.toHaveBeenCalled();
      expect(h.markAccepted).not.toHaveBeenCalled();
    });
  });
});
