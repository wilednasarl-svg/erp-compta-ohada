import type { RolePermissionRepository } from '../repositories/role-permission.repository';
import { PermissionsCacheService } from './permissions-cache.service';

interface Harness {
  service: PermissionsCacheService;
  listPermissionCodesForRole: jest.Mock<Promise<string[]>, [string]>;
}

function buildHarness(): Harness {
  const listPermissionCodesForRole = jest.fn<Promise<string[]>, [string]>();
  const repo = { listPermissionCodesForRole } as unknown as RolePermissionRepository;
  const service = new PermissionsCacheService(repo);
  return { service, listPermissionCodesForRole };
}

describe('PermissionsCacheService (BE-RBAC-09)', () => {
  describe('roleHasPermission', () => {
    it('populates the cache on first hit and serves subsequent hits without a repo call', async () => {
      const h = buildHarness();
      h.listPermissionCodesForRole.mockResolvedValue([
        'accounting.read',
        'accounting.write',
        'organizations.read',
      ]);

      const a = await h.service.roleHasPermission('role-comptable', 'accounting.write');
      const b = await h.service.roleHasPermission('role-comptable', 'accounting.read');
      const c = await h.service.roleHasPermission('role-comptable', 'accounting.sign');

      expect(a).toBe(true);
      expect(b).toBe(true);
      expect(c).toBe(false);
      // ONE repo call for THREE lookups — the cache hit on calls 2/3.
      expect(h.listPermissionCodesForRole).toHaveBeenCalledTimes(1);
      expect(h.listPermissionCodesForRole).toHaveBeenCalledWith('role-comptable');
    });

    it('treats each roleId as a separate cache entry', async () => {
      const h = buildHarness();
      h.listPermissionCodesForRole.mockImplementation((roleId) =>
        Promise.resolve(
          roleId === 'role-admin'
            ? ['organizations.manage_members', 'accounting.sign']
            : ['accounting.read'],
        ),
      );

      const adminHasManage = await h.service.roleHasPermission(
        'role-admin',
        'organizations.manage_members',
      );
      const auditorHasManage = await h.service.roleHasPermission(
        'role-auditeur',
        'organizations.manage_members',
      );

      expect(adminHasManage).toBe(true);
      expect(auditorHasManage).toBe(false);
      expect(h.listPermissionCodesForRole).toHaveBeenCalledTimes(2);
      expect(h.service.size()).toBe(2);
    });
  });

  describe('getPermissionsForRole', () => {
    it('returns the cached Set (reference-stable across calls for the same role)', async () => {
      const h = buildHarness();
      h.listPermissionCodesForRole.mockResolvedValue(['organizations.read']);

      const first = await h.service.getPermissionsForRole('role-comptable');
      const second = await h.service.getPermissionsForRole('role-comptable');

      expect(first).toBe(second);
      expect(first.has('organizations.read')).toBe(true);
    });
  });

  describe('invalidateRole', () => {
    it('drops the entry; next lookup re-hits the repo', async () => {
      const h = buildHarness();
      h.listPermissionCodesForRole.mockResolvedValue(['accounting.read']);

      await h.service.roleHasPermission('role-comptable', 'accounting.read');
      expect(h.listPermissionCodesForRole).toHaveBeenCalledTimes(1);

      h.service.invalidateRole('role-comptable');
      expect(h.service.size()).toBe(0);

      await h.service.roleHasPermission('role-comptable', 'accounting.read');
      expect(h.listPermissionCodesForRole).toHaveBeenCalledTimes(2);
    });

    it('is a no-op for an unknown roleId', () => {
      const h = buildHarness();
      h.service.invalidateRole('never-cached');
      expect(h.service.size()).toBe(0);
    });
  });

  describe('invalidateAll', () => {
    it('clears every entry', async () => {
      const h = buildHarness();
      h.listPermissionCodesForRole.mockResolvedValueOnce(['accounting.read']);
      h.listPermissionCodesForRole.mockResolvedValueOnce(['accounting.sign']);

      await h.service.roleHasPermission('role-comptable', 'accounting.read');
      await h.service.roleHasPermission('role-expert', 'accounting.sign');
      expect(h.service.size()).toBe(2);

      h.service.invalidateAll();

      expect(h.service.size()).toBe(0);
    });
  });
});
