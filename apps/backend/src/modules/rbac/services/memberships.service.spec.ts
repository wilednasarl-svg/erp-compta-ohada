import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { AuthEventContext, AuthEventsService } from '../../audit/services/auth-events.service';
import type { AuthEventEntity } from '../../audit/entities/auth-event.entity';
import type { MembershipEntity, MembershipStatus } from '../entities/membership.entity';
import type { RoleEntity } from '../entities/role.entity';
import type { MembershipRepository } from '../repositories/membership.repository';
import type { RoleRepository } from '../repositories/role.repository';
import { MembershipsService } from './memberships.service';

const CTX: AuthEventContext = { ipAddress: '203.0.113.1', userAgent: 'jest/1.0' };

function buildRole(code: string, id: string = `role-${code}`): RoleEntity {
  return { id, code, name: code, description: null, isSystem: true } as RoleEntity;
}

function buildMembership(overrides: Partial<MembershipEntity> = {}): MembershipEntity {
  return {
    id: 'm-1',
    userId: 'target-user',
    organizationId: 'org-1',
    roleId: 'role-comptable',
    status: 'active' as MembershipStatus,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as MembershipEntity;
}

interface Harness {
  service: MembershipsService;
  findByUserAndOrg: jest.Mock<Promise<MembershipEntity | null>, [string, string]>;
  listActiveWithRelations: jest.Mock<Promise<MembershipEntity[]>, [string]>;
  updateRoleIfNotLastAdmin: jest.Mock<
    Promise<number>,
    [{ userId: string; organizationId: string; newRoleId: string; fromAdminRoleId: string | null }]
  >;
  removeIfNotLastAdmin: jest.Mock<
    Promise<number>,
    [{ userId: string; organizationId: string; adminRoleIdIfAdmin: string | null }]
  >;
  findRoleById: jest.Mock<Promise<RoleEntity | null>, [string]>;
  findRoleByCode: jest.Mock<Promise<RoleEntity | null>, [string]>;
  recordEvent: jest.Mock<
    Promise<AuthEventEntity | null>,
    [string, AuthEventContext, Record<string, unknown>?]
  >;
}

function buildHarness(): Harness {
  const findByUserAndOrg = jest.fn<Promise<MembershipEntity | null>, [string, string]>();
  const listActiveWithRelations = jest
    .fn<Promise<MembershipEntity[]>, [string]>()
    .mockResolvedValue([]);
  // Permissive defaults — 1 row affected = success, no last-admin block.
  // Tests for the last-admin path override with `mockResolvedValue(0)`.
  const updateRoleIfNotLastAdmin = jest
    .fn<
      Promise<number>,
      [{ userId: string; organizationId: string; newRoleId: string; fromAdminRoleId: string | null }]
    >()
    .mockResolvedValue(1);
  const removeIfNotLastAdmin = jest
    .fn<
      Promise<number>,
      [{ userId: string; organizationId: string; adminRoleIdIfAdmin: string | null }]
    >()
    .mockResolvedValue(1);
  const findRoleById = jest.fn<Promise<RoleEntity | null>, [string]>();
  const findRoleByCode = jest.fn<Promise<RoleEntity | null>, [string]>();
  const recordEvent = jest
    .fn<Promise<AuthEventEntity | null>, [string, AuthEventContext, Record<string, unknown>?]>()
    .mockResolvedValue(null);

  const memberships = {
    findByUserAndOrganization: findByUserAndOrg,
    listActiveByOrganizationWithRelations: listActiveWithRelations,
    updateRoleIfNotLastAdmin,
    removeIfNotLastAdmin,
  } as unknown as MembershipRepository;
  const roles = { findById: findRoleById, findByCode: findRoleByCode } as unknown as RoleRepository;
  const audit = { record: recordEvent } as unknown as AuthEventsService;

  const service = new MembershipsService(memberships, roles, audit);

  return {
    service,
    findByUserAndOrg,
    listActiveWithRelations,
    updateRoleIfNotLastAdmin,
    removeIfNotLastAdmin,
    findRoleById,
    findRoleByCode,
    recordEvent,
  };
}

describe('MembershipsService (BE-ORG-05..08 + spec 7.7)', () => {
  describe('listMembers', () => {
    it('projects rows with eager-loaded user + role into the public MemberView; skips rows with missing relations', async () => {
      const h = buildHarness();
      h.listActiveWithRelations.mockResolvedValue([
        {
          userId: 'u-1',
          status: 'active' as MembershipStatus,
          user: { id: 'u-1', email: 'a@b.ci', firstName: 'Yao', lastName: 'Konan' },
          role: { code: 'admin' },
        } as unknown as MembershipEntity,
        {
          // Skipped — no user relation (data integrity hole).
          userId: 'u-2',
          status: 'active' as MembershipStatus,
          user: undefined,
          role: { code: 'comptable' },
        } as unknown as MembershipEntity,
        {
          // Skipped — no role relation.
          userId: 'u-3',
          status: 'active' as MembershipStatus,
          user: { id: 'u-3', email: 'c@b.ci', firstName: null, lastName: null },
          role: undefined,
        } as unknown as MembershipEntity,
      ]);

      const result = await h.service.listMembers('org-1');

      expect(result).toEqual([
        {
          userId: 'u-1',
          email: 'a@b.ci',
          firstName: 'Yao',
          lastName: 'Konan',
          role: 'admin',
          status: 'active',
        },
      ]);
    });
  });

  describe('changeRole', () => {
    it('happy path: updates the role, emits organizations.role_changed with from/to roles', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(buildMembership({ roleId: 'role-comptable' }));
      h.findRoleByCode.mockResolvedValue(buildRole('chef_mission'));
      h.findRoleById.mockResolvedValue(buildRole('comptable'));

      const result = await h.service.changeRole(
        'admin-1',
        'org-1',
        'target-user',
        'chef_mission',
        CTX,
      );

      expect(h.updateRoleIfNotLastAdmin).toHaveBeenCalledWith({
        userId: 'target-user',
        organizationId: 'org-1',
        newRoleId: 'role-chef_mission',
        // Not downgrading admin → no last-admin guard required.
        fromAdminRoleId: null,
      });
      expect(h.recordEvent).toHaveBeenCalledTimes(1);
      expect(h.recordEvent.mock.calls[0][0]).toBe('organizations.role_changed');
      const meta = h.recordEvent.mock.calls[0][2] as {
        targetUserId: string;
        fromRole: string;
        toRole: string;
      };
      expect(meta).toMatchObject({
        targetUserId: 'target-user',
        fromRole: 'comptable',
        toRole: 'chef_mission',
      });
      expect(result.role).toBe('chef_mission');
    });

    it('returns the current view as a no-op when newRole === oldRole (no audit noise)', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(buildMembership({ roleId: 'role-comptable' }));
      h.findRoleByCode.mockResolvedValue(buildRole('comptable'));
      h.findRoleById.mockResolvedValue(buildRole('comptable'));

      const result = await h.service.changeRole(
        'admin-1',
        'org-1',
        'target-user',
        'comptable',
        CTX,
      );

      expect(h.updateRoleIfNotLastAdmin).not.toHaveBeenCalled();
      expect(h.recordEvent).not.toHaveBeenCalled();
      expect(result.role).toBe('comptable');
    });

    it('rejects with ORG_NOT_FOUND when target user has no membership', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(null);

      await expect(
        h.service.changeRole('admin-1', 'org-1', 'ghost-user', 'comptable', CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.ORG_NOT_FOUND });
    });

    it('rejects with ORG_NOT_FOUND when newRoleCode is unknown', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(buildMembership());
      h.findRoleByCode.mockResolvedValue(null);
      h.findRoleById.mockResolvedValue(buildRole('comptable'));

      await expect(
        h.service.changeRole('admin-1', 'org-1', 'target-user', 'godking', CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.ORG_NOT_FOUND });
    });

    it('ORG_LAST_ADMIN (spec 7.7) — refuses to downgrade the only active admin', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(
        buildMembership({ userId: 'lone-admin', roleId: 'role-admin' }),
      );
      h.findRoleByCode.mockResolvedValue(buildRole('comptable'));
      h.findRoleById.mockResolvedValue(buildRole('admin'));
      // The atomic SQL guard returns 0 when the last-admin lock-count
      // check would refuse the downgrade.
      h.updateRoleIfNotLastAdmin.mockResolvedValue(0);

      await expect(
        h.service.changeRole('actor-1', 'org-1', 'lone-admin', 'comptable', CTX),
      ).rejects.toMatchObject({
        code: ERROR_CODES.ORG_LAST_ADMIN,
        status: 409,
      });
      // Repo was called WITH the admin guard set; service mapped the
      // zero-affected return to ORG_LAST_ADMIN.
      expect(h.updateRoleIfNotLastAdmin).toHaveBeenCalledWith({
        userId: 'lone-admin',
        organizationId: 'org-1',
        newRoleId: 'role-comptable',
        fromAdminRoleId: 'role-admin',
      });
      expect(h.recordEvent).not.toHaveBeenCalled();
    });

    it('ORG_LAST_ADMIN — allows downgrade when at least 2 active admins remain', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(
        buildMembership({ userId: 'admin-1', roleId: 'role-admin' }),
      );
      h.findRoleByCode.mockResolvedValue(buildRole('comptable'));
      h.findRoleById.mockResolvedValue(buildRole('admin'));
      // Default permissive mock (returns 1) — repo's SQL guard would
      // have found 2 admins and allowed the row.

      await h.service.changeRole('actor-1', 'org-1', 'admin-1', 'comptable', CTX);

      expect(h.updateRoleIfNotLastAdmin).toHaveBeenCalledWith({
        userId: 'admin-1',
        organizationId: 'org-1',
        newRoleId: 'role-comptable',
        fromAdminRoleId: 'role-admin',
      });
    });

    it('ORG_LAST_ADMIN — skips the admin guard when target is NOT an admin (no false invariant trip)', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(
        buildMembership({ userId: 'comptable-1', roleId: 'role-comptable' }),
      );
      h.findRoleByCode.mockResolvedValue(buildRole('chef_mission'));
      h.findRoleById.mockResolvedValue(buildRole('comptable'));

      await h.service.changeRole('actor-1', 'org-1', 'comptable-1', 'chef_mission', CTX);

      // `fromAdminRoleId: null` signals the repo to skip the FOR-UPDATE
      // lock + count entirely (non-admin downgrade has no invariant to
      // protect).
      expect(h.updateRoleIfNotLastAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ fromAdminRoleId: null }),
      );
    });
  });

  describe('removeMember (BE-ORG-07)', () => {
    it('happy path: deletes the membership, emits organizations.role_changed with action=removed', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(buildMembership({ roleId: 'role-comptable' }));
      h.findRoleById.mockResolvedValue(buildRole('comptable'));

      await h.service.removeMember('admin-1', 'org-1', 'target-user', CTX);

      // Non-admin target → guard skipped (`adminRoleIdIfAdmin: null`),
      // repo runs the plain DELETE path.
      expect(h.removeIfNotLastAdmin).toHaveBeenCalledWith({
        userId: 'target-user',
        organizationId: 'org-1',
        adminRoleIdIfAdmin: null,
      });
      expect(h.recordEvent).toHaveBeenCalledTimes(1);
      expect(h.recordEvent.mock.calls[0][0]).toBe('organizations.role_changed');
      const meta = h.recordEvent.mock.calls[0][2] as {
        targetUserId: string;
        fromRole: string;
        toRole: string | null;
        action: string;
      };
      expect(meta).toEqual({
        targetUserId: 'target-user',
        fromRole: 'comptable',
        toRole: null,
        action: 'removed',
      });
    });

    it('rejects with ORG_NOT_FOUND when target user has no membership', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(null);

      await expect(h.service.removeMember('admin-1', 'org-1', 'ghost', CTX)).rejects.toMatchObject({
        code: ERROR_CODES.ORG_NOT_FOUND,
      });
      expect(h.removeIfNotLastAdmin).not.toHaveBeenCalled();
    });

    it('ORG_LAST_ADMIN — refuses to remove the only active admin (spec scenario "Last admin attempts to leave")', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(
        buildMembership({ userId: 'lone-admin', roleId: 'role-admin' }),
      );
      h.findRoleById.mockResolvedValue(buildRole('admin'));
      // The atomic SQL guard returns 0 when the FOR-UPDATE lock + count
      // would refuse the removal.
      h.removeIfNotLastAdmin.mockResolvedValue(0);

      await expect(
        h.service.removeMember('lone-admin', 'org-1', 'lone-admin', CTX),
      ).rejects.toMatchObject({
        code: ERROR_CODES.ORG_LAST_ADMIN,
        status: 409,
      });
      expect(h.removeIfNotLastAdmin).toHaveBeenCalledWith({
        userId: 'lone-admin',
        organizationId: 'org-1',
        adminRoleIdIfAdmin: 'role-admin',
      });
      expect(h.recordEvent).not.toHaveBeenCalled();
    });

    it('ORG_LAST_ADMIN — allows removal when 2+ admins remain', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(
        buildMembership({ userId: 'admin-2', roleId: 'role-admin' }),
      );
      h.findRoleById.mockResolvedValue(buildRole('admin'));
      // Default permissive mock (returns 1) — repo's SQL guard would
      // have found 2 admins and allowed the row.

      await h.service.removeMember('admin-1', 'org-1', 'admin-2', CTX);

      expect(h.removeIfNotLastAdmin).toHaveBeenCalledWith({
        userId: 'admin-2',
        organizationId: 'org-1',
        adminRoleIdIfAdmin: 'role-admin',
      });
    });

    it('skips the admin guard when target is NOT an admin', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(buildMembership({ roleId: 'role-comptable' }));
      h.findRoleById.mockResolvedValue(buildRole('comptable'));

      await h.service.removeMember('admin-1', 'org-1', 'target-user', CTX);

      expect(h.removeIfNotLastAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ adminRoleIdIfAdmin: null }),
      );
    });
  });
});
