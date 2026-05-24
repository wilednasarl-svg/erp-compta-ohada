import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { RequestContext } from '../../../common/types/request-context';
import { ROLES_METADATA_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

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

function withRoles(reflector: Reflector, allowed: ReadonlyArray<string> | undefined): void {
  jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
    if (key === ROLES_METADATA_KEY) {
      return allowed;
    }
    return undefined;
  });
}

describe('RolesGuard (BE-RBAC-03)', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows when no @Roles() annotation is set (opt-in by design)', () => {
    withRoles(reflector, undefined);
    const { ctx } = buildExecutionContext();
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows when the caller role is in the allow-list', () => {
    withRoles(reflector, ['admin', 'expert_comptable']);
    const { ctx } = buildExecutionContext({
      currentOrg: { id: 'o', name: 'Test Org', roleId: 'r', role: 'admin', membershipId: 'm' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws FORBIDDEN_ROLE (403) when the caller role is not in the allow-list', () => {
    withRoles(reflector, ['admin']);
    const { ctx } = buildExecutionContext({
      currentOrg: { id: 'o', name: 'Test Org', roleId: 'r', role: 'comptable', membershipId: 'm' },
    });

    try {
      guard.canActivate(ctx);
      fail('should have thrown');
    } catch (error: unknown) {
      expect(AppException.isAppException(error)).toBe(true);
      expect((error as AppException).code).toBe(ERROR_CODES.FORBIDDEN_ROLE);
      expect((error as AppException).status).toBe(403);
      expect((error as AppException).details).toEqual({
        role: 'comptable',
        allowed: ['admin'],
      });
    }
  });

  it('throws FORBIDDEN_NO_MEMBERSHIP when no currentOrg is bound (TenantGuard missing)', () => {
    withRoles(reflector, ['admin']);
    const { ctx } = buildExecutionContext(); // no currentOrg

    try {
      guard.canActivate(ctx);
      fail('should have thrown');
    } catch (error: unknown) {
      expect((error as AppException).code).toBe(ERROR_CODES.FORBIDDEN_NO_MEMBERSHIP);
    }
  });

  it('empty allow-list `@Roles()` deactivates the route (fail-closed)', () => {
    withRoles(reflector, []);
    const { ctx } = buildExecutionContext({
      currentOrg: { id: 'o', name: 'Test Org', roleId: 'r', role: 'admin', membershipId: 'm' },
    });

    expect(() => guard.canActivate(ctx)).toThrow(AppException);
  });

  it('passes through non-HTTP contexts', () => {
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

    expect(guard.canActivate(ctx)).toBe(true);
  });
});
