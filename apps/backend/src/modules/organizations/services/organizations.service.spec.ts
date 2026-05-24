import type { DataSource, EntityManager } from 'typeorm';

import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { ChartOfAccountsService } from '../../accounting-plan/services/chart-of-accounts.service';
import type { AuthEventContext, AuthEventsService } from '../../audit/services/auth-events.service';
import type { JournalsService } from '../../journals/services/journals.service';
import type { TvaCodesService } from '../../tva/services/tva-codes.service';
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
  /** Captures the OrganizationEntity passed to manager.save inside the txn. */
  managerSave: jest.Mock;
  /** Captures the txn-scoped clone call so we can assert "system + manager forwarded". */
  cloneInOrg: jest.Mock;
  updateName: jest.Mock<Promise<OrganizationEntity | null>, [string, string]>;
  listOrgsForUser: jest.Mock<Promise<MembershipEntity[]>, [string]>;
  findRoleByCode: jest.Mock<Promise<RoleEntity | null>, [string]>;
  recordEvent: jest.Mock<
    Promise<AuthEventEntity | null>,
    [string, AuthEventContext, Record<string, unknown>?]
  >;
  seedDefaultCodes: jest.Mock;
}

function buildHarness(): Harness {
  const findActiveById = jest.fn<Promise<OrganizationEntity | null>, [string]>();
  const slugExists = jest.fn<Promise<boolean>, [string]>().mockResolvedValue(false);
  const updateName = jest.fn<Promise<OrganizationEntity | null>, [string, string]>();
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

  // Single jest.fn captures every `manager.getRepository(X).save(...)` call
  // in the order they happen — first call is the org, second the
  // membership, third the accounting config (cf. service.create).
  let savedOrgId = 'org-new';
  const managerSave = jest.fn().mockImplementation((entity: Record<string, unknown>) => {
    // The first save is the org — assign it the canonical id so the
    // membership + config can pin to it via FK semantics.
    if (
      typeof entity['slug'] === 'string' &&
      entity['id'] === undefined &&
      entity['organizationId'] === undefined
    ) {
      const persisted = { ...entity, id: savedOrgId } as OrganizationEntity;
      savedOrgId = (persisted.id as string) ?? savedOrgId;
      return Promise.resolve(persisted);
    }
    return Promise.resolve({ ...entity, id: 'm-new' });
  });

  const fakeManager = {
    getRepository: (_target: unknown) => ({
      create: (input: Record<string, unknown>) => input,
      save: managerSave,
    }),
  } as unknown as EntityManager;

  const cloneInOrg = jest.fn().mockResolvedValue({ added: 800, skipped: 0 });

  const orgRepo = {
    findActiveById,
    slugExists,
    create: jest.fn(),
    updateName,
    findActiveBySlug: jest.fn(),
    softDelete: jest.fn(),
  } as unknown as OrganizationRepository;
  const memberRepo = {
    listOrganizationsForUser: listOrgsForUser,
  } as unknown as MembershipRepository;
  const roleRepo = { findByCode: findRoleByCode } as unknown as RoleRepository;
  const audit = { record: recordEvent } as unknown as AuthEventsService;
  const chartOfAccounts = {
    cloneReferenceIntoOrganization: cloneInOrg,
  } as unknown as ChartOfAccountsService;
  const journals = {
    seedStandardJournals: jest.fn().mockResolvedValue(undefined),
  } as unknown as JournalsService;
  const tvaCodes = {
    seedDefaultCodes: jest.fn().mockResolvedValue(undefined),
  } as unknown as TvaCodesService;
  const dataSource = {
    transaction: (cb: (m: EntityManager) => Promise<unknown>) => cb(fakeManager),
  } as unknown as DataSource;

  const service = new OrganizationsService(
    orgRepo,
    memberRepo,
    roleRepo,
    audit,
    chartOfAccounts,
    journals,
    tvaCodes,
    dataSource,
  );

  return {
    service,
    findActiveById,
    slugExists,
    managerSave,
    cloneInOrg,
    updateName,
    listOrgsForUser,
    findRoleByCode,
    recordEvent,
    seedDefaultCodes: tvaCodes.seedDefaultCodes as jest.Mock,
  };
}

describe('OrganizationsService (BE-ORG-01..03 + BE-PC-08)', () => {
  describe('create', () => {
    it('happy path: org + membership + accounting config saved inside one txn, plan cloned, both audit events emitted', async () => {
      const h = buildHarness();

      const result = await h.service.create(
        'user-1',
        { name: 'Cabinet Konan & Associés', type: 'firm', system: 'NORMAL' },
        CTX,
      );

      expect(h.findRoleByCode).toHaveBeenCalledWith('admin');

      // 3 saves through the txn manager: org, membership, accounting config (in that order).
      expect(h.managerSave).toHaveBeenCalledTimes(3);

      const savedOrg = h.managerSave.mock.calls[0][0] as Record<string, unknown>;
      expect(savedOrg.slug).toBe('cabinet-konan-associes');
      expect(savedOrg.type).toBe('firm');

      const savedMembership = h.managerSave.mock.calls[1][0] as Record<string, unknown>;
      expect(savedMembership.userId).toBe('user-1');
      expect(savedMembership.roleId).toBe('role-admin');
      expect(savedMembership.status).toBe('active');
      expect(savedMembership.organizationId).toBe('org-new');

      const savedConfig = h.managerSave.mock.calls[2][0] as Record<string, unknown>;
      expect(savedConfig.system).toBe('NORMAL');
      expect(savedConfig.organizationId).toBe('org-new');

      // Clone joins the same transaction (3rd positional arg is the manager).
      expect(h.cloneInOrg).toHaveBeenCalledTimes(1);
      expect(h.cloneInOrg.mock.calls[0][0]).toBe('org-new');
      expect(h.cloneInOrg.mock.calls[0][1]).toBe('NORMAL');
      expect(h.cloneInOrg.mock.calls[0][2]).toBeDefined(); // manager

      // Seed TVA codes joins the same transaction.
      expect(h.seedDefaultCodes).toHaveBeenCalledTimes(1);
      expect(h.seedDefaultCodes.mock.calls[0][0]).toBe('org-new');
      expect(h.seedDefaultCodes.mock.calls[0][1]).toBeDefined(); // manager

      // Two audit events, in order: organizations.updated (with action=created) + chart_of_accounts.imported.
      expect(h.recordEvent).toHaveBeenCalledTimes(2);
      expect(h.recordEvent.mock.calls[0][0]).toBe('organizations.updated');
      const orgMeta = h.recordEvent.mock.calls[0][2] as {
        action: string;
        slug: string;
        system: string;
      };
      expect(orgMeta).toMatchObject({
        action: 'created',
        slug: 'cabinet-konan-associes',
        system: 'NORMAL',
      });
      expect(h.recordEvent.mock.calls[1][0]).toBe('chart_of_accounts.imported');
      const importMeta = h.recordEvent.mock.calls[1][2] as { system: string; accountCount: number };
      expect(importMeta).toEqual({ system: 'NORMAL', accountCount: 800 });

      expect(result.organization.slug).toBe('cabinet-konan-associes');
      expect(result.membership.userId).toBe('user-1');
      expect(result.system).toBe('NORMAL');
    });

    it('appends -2, -3, … to the slug on collision until a free one is found', async () => {
      const h = buildHarness();
      // base + base-2 taken, base-3 free
      h.slugExists.mockImplementation((slug) =>
        Promise.resolve(slug === 'cabinet-konan' || slug === 'cabinet-konan-2'),
      );

      await h.service.create(
        'user-1',
        { name: 'Cabinet Konan', type: 'firm', system: 'NORMAL' },
        CTX,
      );

      const calls = h.slugExists.mock.calls.map((c) => c[0]);
      expect(calls).toEqual(['cabinet-konan', 'cabinet-konan-2', 'cabinet-konan-3']);
      const savedOrg = h.managerSave.mock.calls[0][0] as Record<string, unknown>;
      expect(savedOrg.slug).toBe('cabinet-konan-3');
    });

    it('rejects with ORG_NOT_FOUND when the admin role is not seeded (broken install)', async () => {
      const h = buildHarness();
      h.findRoleByCode.mockResolvedValue(null);

      await expect(
        h.service.create('user-1', { name: 'Cabinet Konan', type: 'firm', system: 'NORMAL' }, CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.ORG_NOT_FOUND });
      expect(h.managerSave).not.toHaveBeenCalled();
      expect(h.cloneInOrg).not.toHaveBeenCalled();
      expect(h.recordEvent).not.toHaveBeenCalled();
    });

    it.each([['MINIMAL'], ['ALLEGE']])(
      'forwards system=%s verbatim to the accounting config + clone',
      async (system) => {
        const h = buildHarness();
        await h.service.create(
          'user-1',
          { name: 'Cabinet Konan', type: 'firm', system: system as 'MINIMAL' | 'ALLEGE' },
          CTX,
        );
        const savedConfig = h.managerSave.mock.calls[2][0] as Record<string, unknown>;
        expect(savedConfig.system).toBe(system);
        expect(h.cloneInOrg.mock.calls[0][1]).toBe(system);
      },
    );
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
