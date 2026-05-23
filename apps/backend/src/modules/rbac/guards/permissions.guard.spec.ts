import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { RequestContext } from '../../../common/types/request-context';
import { REQUIRE_PERMISSION_METADATA_KEY } from '../decorators/require-permission.decorator';
import type { PermissionsCacheService } from '../services/permissions-cache.service';
import { PermissionsGuard } from './permissions.guard';

function buildExecutionContext(contextBag?: RequestContext): {
  ctx: ExecutionContext;
  req: Request & { context?: RequestContext };
} {
  const req = { context: contextBag } as unknown as Request & { context?: RequestContext };
  const handler = (): void => undefined;
  class FakeController {}
  const ctx = {
    getType: () => 'http' as const,
    getHandler: () => handler,
    getClass: () => FakeController,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function withPermission(reflector: Reflector, code: string | undefined): void {
  jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
    if (key === REQUIRE_PERMISSION_METADATA_KEY) {
      return code;
    }
    return undefined;
  });
}

function buildCache(roleHasPermission: jest.Mock): PermissionsCacheService {
  return { roleHasPermission } as unknown as PermissionsCacheService;
}

describe('PermissionsGuard (BE-RBAC-04)', () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
  });

  it('allows when the role has the required permission', async () => {
    const roleHasPermission = jest.fn().mockResolvedValue(true);
    const guard = new PermissionsGuard(reflector, buildCache(roleHasPermission));
    withPermission(reflector, 'organizations.update');
    const { ctx } = buildExecutionContext({
      currentOrg: { id: 'o', roleId: 'r_admin_id', role: 'admin', membershipId: 'm' },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(roleHasPermission).toHaveBeenCalledWith('r_admin_id', 'organizations.update');
  });

  it('throws FORBIDDEN_PERMISSION (403) when the role lacks the permission', async () => {
    const roleHasPermission = jest.fn().mockResolvedValue(false);
    const guard = new PermissionsGuard(reflector, buildCache(roleHasPermission));
    withPermission(reflector, 'organizations.delete');
    const { ctx } = buildExecutionContext({
      currentOrg: { id: 'o', roleId: 'r_comptable_id', role: 'comptable', membershipId: 'm' },
    });

    try {
      await guard.canActivate(ctx);
      fail('should have thrown');
    } catch (error: unknown) {
      expect(AppException.isAppException(error)).toBe(true);
      expect((error as AppException).code).toBe(ERROR_CODES.FORBIDDEN_PERMISSION);
      expect((error as AppException).status).toBe(403);
      expect((error as AppException).details).toEqual({
        role: 'comptable',
        permission: 'organizations.delete',
      });
    }
  });

  it('DENY-BY-DEFAULT: throws RBAC_NO_POLICY_DECLARED when no @RequirePermission annotation is present', async () => {
    const roleHasPermission = jest.fn();
    const guard = new PermissionsGuard(reflector, buildCache(roleHasPermission));
    withPermission(reflector, undefined);
    const { ctx } = buildExecutionContext({
      currentOrg: { id: 'o', roleId: 'r', role: 'admin', membershipId: 'm' },
    });

    try {
      await guard.canActivate(ctx);
      fail('should have thrown');
    } catch (error: unknown) {
      expect((error as AppException).code).toBe(ERROR_CODES.RBAC_NO_POLICY_DECLARED);
    }
    expect(roleHasPermission).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN_NO_MEMBERSHIP when currentOrg is missing (TenantGuard not composed)', async () => {
    const guard = new PermissionsGuard(reflector, buildCache(jest.fn()));
    withPermission(reflector, 'organizations.read');
    const { ctx } = buildExecutionContext(); // no currentOrg

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN_NO_MEMBERSHIP,
    });
  });

  it('passes through non-HTTP contexts without DB calls', async () => {
    const roleHasPermission = jest.fn();
    const guard = new PermissionsGuard(reflector, buildCache(roleHasPermission));
    const handler = (): void => undefined;
    class FakeController {}
    const ctx = {
      getType: () => 'rpc' as const,
      getHandler: () => handler,
      getClass: () => FakeController,
      switchToHttp: () => ({
        getRequest: () => ({}),
        getResponse: () => ({}),
        getNext: () => undefined,
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(roleHasPermission).not.toHaveBeenCalled();
  });
});
