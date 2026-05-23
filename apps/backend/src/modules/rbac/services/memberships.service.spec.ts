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
  countActiveAdmins: jest.Mock<Promise<number>, [string, string]>;
  updateRole: jest.Mock<Promise<void>, [string, string, string]>;
  removeRepo: jest.Mock<Promise<void>, [string, string]>;
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
  const countActiveAdmins = jest.fn<Promise<number>, [string, string]>().mockResolvedValue(99); // permissive by default; tests override
  const updateRole = jest
    .fn<Promise<void>, [string, string, string]>()
    .mockResolvedValue(undefined);
  const removeRepo = jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined);
  const findRoleById = jest.fn<Promise<RoleEntity | null>, [string]>();
  const findRoleByCode = jest.fn<Promise<RoleEntity | null>, [string]>();
  const recordEvent = jest
    .fn<Promise<AuthEventEntity | null>, [string, AuthEventContext, Record<string, unknown>?]>()
    .mockResolvedValue(null);

  const memberships = {
    findByUserAndOrganization: findByUserAndOrg,
    listActiveByOrganizationWithRelations: listActiveWithRelations,
    countActiveAdminsForOrganization: countActiveAdmins,
    updateRole,
    remove: removeRepo,
  } as unknown as MembershipRepository;
  const roles = { findById: findRoleById, findByCode: findRoleByCode } as unknown as RoleRepository;
  const audit = { record: recordEvent } as unknown as AuthEventsService;

  const service = new MembershipsService(memberships, roles, audit);

  return {
    service,
    findByUserAndOrg,
    listActiveWithRelations,
    countActiveAdmins,
    updateRole,
    removeRepo,
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

      expect(h.updateRole).toHaveBeenCalledWith('target-user', 'org-1', 'role-chef_mission');
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

      expect(h.updateRole).not.toHaveBeenCalled();
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
      h.countActiveAdmins.mockResolvedValue(1); // only admin remaining

      await expect(
        h.service.changeRole('actor-1', 'org-1', 'lone-admin', 'comptable', CTX),
      ).rejects.toMatchObject({
        code: ERROR_CODES.ORG_LAST_ADMIN,
        status: 409,
      });
      expect(h.updateRole).not.toHaveBeenCalled();
      expect(h.recordEvent).not.toHaveBeenCalled();
    });

    it('ORG_LAST_ADMIN — allows downgrade when at least 2 active admins remain', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(
        buildMembership({ userId: 'admin-1', roleId: 'role-admin' }),
      );
      h.findRoleByCode.mockResolvedValue(buildRole('comptable'));
      h.findRoleById.mockResolvedValue(buildRole('admin'));
      h.countActiveAdmins.mockResolvedValue(2);

      await h.service.changeRole('actor-1', 'org-1', 'admin-1', 'comptable', CTX);

      expect(h.updateRole).toHaveBeenCalled();
    });

    it('ORG_LAST_ADMIN — skips the count when target is NOT an admin (no false invariant trip)', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(
        buildMembership({ userId: 'comptable-1', roleId: 'role-comptable' }),
      );
      h.findRoleByCode.mockResolvedValue(buildRole('chef_mission'));
      h.findRoleById.mockResolvedValue(buildRole('comptable'));

      await h.service.changeRole('actor-1', 'org-1', 'comptable-1', 'chef_mission', CTX);

      expect(h.countActiveAdmins).not.toHaveBeenCalled();
      expect(h.updateRole).toHaveBeenCalled();
    });
  });

  describe('removeMember (BE-ORG-07)', () => {
    it('happy path: deletes the membership, emits organizations.role_changed with action=removed', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(buildMembership({ roleId: 'role-comptable' }));
      h.findRoleById.mockResolvedValue(buildRole('comptable'));

      await h.service.removeMember('admin-1', 'org-1', 'target-user', CTX);

      expect(h.removeRepo).toHaveBeenCalledWith('target-user', 'org-1');
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
      expect(h.removeRepo).not.toHaveBeenCalled();
    });

    it('ORG_LAST_ADMIN — refuses to remove the only active admin (spec scenario "Last admin attempts to leave")', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(
        buildMembership({ userId: 'lone-admin', roleId: 'role-admin' }),
      );
      h.findRoleById.mockResolvedValue(buildRole('admin'));
      h.countActiveAdmins.mockResolvedValue(1);

      await expect(
        h.service.removeMember('lone-admin', 'org-1', 'lone-admin', CTX),
      ).rejects.toMatchObject({
        code: ERROR_CODES.ORG_LAST_ADMIN,
        status: 409,
      });
      expect(h.removeRepo).not.toHaveBeenCalled();
      expect(h.recordEvent).not.toHaveBeenCalled();
    });

    it('ORG_LAST_ADMIN — allows removal when 2+ admins remain', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(
        buildMembership({ userId: 'admin-2', roleId: 'role-admin' }),
      );
      h.findRoleById.mockResolvedValue(buildRole('admin'));
      h.countActiveAdmins.mockResolvedValue(2);

      await h.service.removeMember('admin-1', 'org-1', 'admin-2', CTX);

      expect(h.removeRepo).toHaveBeenCalled();
    });

    it('skips the admin count when target is NOT an admin', async () => {
      const h = buildHarness();
      h.findByUserAndOrg.mockResolvedValue(buildMembership({ roleId: 'role-comptable' }));
      h.findRoleById.mockResolvedValue(buildRole('comptable'));

      await h.service.removeMember('admin-1', 'org-1', 'target-user', CTX);

      expect(h.countActiveAdmins).not.toHaveBeenCalled();
      expect(h.removeRepo).toHaveBeenCalled();
    });
  });
});
