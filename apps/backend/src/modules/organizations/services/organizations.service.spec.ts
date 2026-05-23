import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { AuthEventContext, AuthEventsService } from '../../audit/services/auth-events.service';
import type { AuthEventEntity } from '../../audit/entities/auth-event.entity';
import type { MembershipEntity } from '../../rbac/entities/membership.entity';
import type { RoleEntity } from '../../rbac/entities/role.entity';
import type { MembershipRepository } from '../../rbac/repositories/membership.repository';
import type { RoleRepository } from '../../rbac/repositories/role.repository';
import type { OrganizationEntity, OrganizationType } from '../entities/organization.entity';
import type { OrganizationRepository } from '../repositories/organization.repository';
import { OrganizationsService } from './organizations.service';

const CTX: AuthEventContext = { ipAddress: '203.0.113.1', userAgent: 'jest/1.0' };

function buildOrg(overrides: Partial<OrganizationEntity> = {}): OrganizationEntity {
  return {
    id: 'org-1',
    name: 'Cabinet Konan',
    slug: 'cabinet-konan',
    type: 'firm' as OrganizationType,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as OrganizationEntity;
}

interface Harness {
  service: OrganizationsService;
  findActiveById: jest.Mock<Promise<OrganizationEntity | null>, [string]>;
  slugExists: jest.Mock<Promise<boolean>, [string]>;
  createOrg: jest.Mock<
    Promise<OrganizationEntity>,
    [{ name: string; slug: string; type: OrganizationType }]
  >;
  updateName: jest.Mock<Promise<OrganizationEntity | null>, [string, string]>;
  createMembership: jest.Mock<
    Promise<MembershipEntity>,
    [{ userId: string; organizationId: string; roleId: string; status?: 'active' | 'suspended' }]
  >;
  listOrgsForUser: jest.Mock<Promise<MembershipEntity[]>, [string]>;
  findRoleByCode: jest.Mock<Promise<RoleEntity | null>, [string]>;
  recordEvent: jest.Mock<
    Promise<AuthEventEntity | null>,
    [string, AuthEventContext, Record<string, unknown>?]
  >;
}

function buildHarness(): Harness {
  const findActiveById = jest.fn<Promise<OrganizationEntity | null>, [string]>();
  const slugExists = jest.fn<Promise<boolean>, [string]>().mockResolvedValue(false);
  const createOrg = jest
    .fn<Promise<OrganizationEntity>, [{ name: string; slug: string; type: OrganizationType }]>()
    .mockImplementation((input) =>
      Promise.resolve(
        buildOrg({ id: 'org-new', name: input.name, slug: input.slug, type: input.type }),
      ),
    );
  const updateName = jest.fn<Promise<OrganizationEntity | null>, [string, string]>();
  const createMembership = jest
    .fn<
      Promise<MembershipEntity>,
      [{ userId: string; organizationId: string; roleId: string; status?: 'active' | 'suspended' }]
    >()
    .mockImplementation((input) =>
      Promise.resolve({
        id: 'm-new',
        userId: input.userId,
        organizationId: input.organizationId,
        roleId: input.roleId,
        status: 'active',
      } as MembershipEntity),
    );
  const listOrgsForUser = jest.fn<Promise<MembershipEntity[]>, [string]>().mockResolvedValue([]);
  const findRoleByCode = jest
    .fn<Promise<RoleEntity | null>, [string]>()
    .mockImplementation((code) =>
      Promise.resolve({
        id: `role-${code}`,
        code,
        name: code,
        description: null,
        isSystem: true,
      } as RoleEntity),
    );
  const recordEvent = jest
    .fn<Promise<AuthEventEntity | null>, [string, AuthEventContext, Record<string, unknown>?]>()
    .mockResolvedValue(null);

  const orgRepo = {
    findActiveById,
    slugExists,
    create: createOrg,
    updateName,
    findActiveBySlug: jest.fn(),
    softDelete: jest.fn(),
  } as unknown as OrganizationRepository;
  const memberRepo = {
    create: createMembership,
    listOrganizationsForUser: listOrgsForUser,
  } as unknown as MembershipRepository;
  const roleRepo = { findByCode: findRoleByCode } as unknown as RoleRepository;
  const audit = { record: recordEvent } as unknown as AuthEventsService;

  const service = new OrganizationsService(orgRepo, memberRepo, roleRepo, audit);

  return {
    service,
    findActiveById,
    slugExists,
    createOrg,
    updateName,
    createMembership,
    listOrgsForUser,
    findRoleByCode,
    recordEvent,
  };
}

describe('OrganizationsService (BE-ORG-01..03)', () => {
  describe('create', () => {
    it('happy path: derives slug, persists org, auto-creates admin membership, journals organizations.updated', async () => {
      const h = buildHarness();

      const result = await h.service.create(
        'user-1',
        { name: 'Cabinet Konan & Associés', type: 'firm' },
        CTX,
      );

      expect(h.findRoleByCode).toHaveBeenCalledWith('admin');
      expect(h.createOrg).toHaveBeenCalledTimes(1);
      const persistedOrg = h.createOrg.mock.calls[0][0];
      expect(persistedOrg.slug).toBe('cabinet-konan-associes');
      expect(persistedOrg.type).toBe('firm');

      expect(h.createMembership).toHaveBeenCalledTimes(1);
      const persistedMembership = h.createMembership.mock.calls[0][0];
      expect(persistedMembership.userId).toBe('user-1');
      expect(persistedMembership.roleId).toBe('role-admin');
      expect(persistedMembership.status).toBe('active');

      expect(h.recordEvent).toHaveBeenCalledTimes(1);
      expect(h.recordEvent.mock.calls[0][0]).toBe('organizations.updated');
      const meta = h.recordEvent.mock.calls[0][2] as { action: string; slug: string };
      expect(meta.action).toBe('created');
      expect(meta.slug).toBe('cabinet-konan-associes');

      expect(result.organization.slug).toBe('cabinet-konan-associes');
      expect(result.membership.userId).toBe('user-1');
    });

    it('appends -2, -3, … to the slug on collision until a free one is found', async () => {
      const h = buildHarness();
      // base + base-2 taken, base-3 free
      h.slugExists.mockImplementation((slug) =>
        Promise.resolve(slug === 'cabinet-konan' || slug === 'cabinet-konan-2'),
      );

      await h.service.create('user-1', { name: 'Cabinet Konan', type: 'firm' }, CTX);

      const calls = h.slugExists.mock.calls.map((c) => c[0]);
      expect(calls).toEqual(['cabinet-konan', 'cabinet-konan-2', 'cabinet-konan-3']);
      expect(h.createOrg.mock.calls[0][0].slug).toBe('cabinet-konan-3');
    });

    it('rejects with ORG_NOT_FOUND when the admin role is not seeded (broken install)', async () => {
      const h = buildHarness();
      h.findRoleByCode.mockResolvedValue(null);

      await expect(
        h.service.create('user-1', { name: 'Cabinet Konan', type: 'firm' }, CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.ORG_NOT_FOUND });
      expect(h.createOrg).not.toHaveBeenCalled();
      expect(h.createMembership).not.toHaveBeenCalled();
    });
  });

  describe('listForUser', () => {
    it('projects each active membership into { id, name, slug, role } and skips soft-deleted orgs / missing relations', async () => {
      const h = buildHarness();
      h.listOrgsForUser.mockResolvedValue([
        {
          organization: {
            id: 'org-A',
            name: 'A',
            slug: 'a',
            deletedAt: null,
          } as OrganizationEntity,
          role: { code: 'admin' } as RoleEntity,
        } as unknown as MembershipEntity,
        {
          // Skipped: soft-deleted org.
          organization: {
            id: 'org-B',
            name: 'B',
            slug: 'b',
            deletedAt: new Date(),
          } as OrganizationEntity,
          role: { code: 'comptable' } as RoleEntity,
        } as unknown as MembershipEntity,
        {
          // Skipped: missing role relation (data integrity hole).
          organization: {
            id: 'org-C',
            name: 'C',
            slug: 'c',
            deletedAt: null,
          } as OrganizationEntity,
          role: undefined,
        } as unknown as MembershipEntity,
        {
          // Skipped: missing org relation.
          organization: undefined,
          role: { code: 'auditeur' } as RoleEntity,
        } as unknown as MembershipEntity,
      ]);

      const result = await h.service.listForUser('user-1');

      expect(result).toEqual([{ id: 'org-A', name: 'A', slug: 'a', role: 'admin' }]);
    });

    it('returns [] for a user with no memberships', async () => {
      const h = buildHarness();
      h.listOrgsForUser.mockResolvedValue([]);

      const result = await h.service.listForUser('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('update', () => {
    it('happy path: renames the org, journals organizations.updated', async () => {
      const h = buildHarness();
      h.updateName.mockResolvedValue(buildOrg({ id: 'org-1', name: 'New Name' }));

      const result = await h.service.update('user-1', 'org-1', 'org-1', { name: 'New Name' }, CTX);

      expect(h.updateName).toHaveBeenCalledWith('org-1', 'New Name');
      expect(h.recordEvent).toHaveBeenCalledTimes(1);
      expect(h.recordEvent.mock.calls[0][0]).toBe('organizations.updated');
      const meta = h.recordEvent.mock.calls[0][2] as { action: string; fields: string[] };
      expect(meta).toEqual({ action: 'updated', fields: ['name'] });
      expect(result.organization.name).toBe('New Name');
    });

    it('rejects with ORG_NOT_FOUND when the URL :id mismatches the token org_id (cross-tenant attempt)', async () => {
      const h = buildHarness();

      await expect(
        h.service.update('user-1', 'org-B', 'org-A', { name: 'x' }, CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.ORG_NOT_FOUND });
      expect(h.updateName).not.toHaveBeenCalled();
      expect(h.recordEvent).not.toHaveBeenCalled();
    });

    it('rejects with ORG_NOTHING_TO_UPDATE when the body is empty (slug-only request filtered by DTO whitelist)', async () => {
      const h = buildHarness();

      await expect(h.service.update('user-1', 'org-1', 'org-1', {}, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.ORG_NOTHING_TO_UPDATE,
      });
      expect(h.updateName).not.toHaveBeenCalled();
    });

    it('rejects with ORG_NOT_FOUND when the row vanished between TenantGuard and updateName', async () => {
      const h = buildHarness();
      h.updateName.mockResolvedValue(null);

      await expect(
        h.service.update('user-1', 'org-1', 'org-1', { name: 'x' }, CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.ORG_NOT_FOUND });
      expect(h.recordEvent).not.toHaveBeenCalled();
    });
  });
});
