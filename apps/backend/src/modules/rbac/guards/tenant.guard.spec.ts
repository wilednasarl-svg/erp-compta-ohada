import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { CurrentUserContext, RequestContext } from '../../../common/types/request-context';
import type { AuthEventsService } from '../../audit/services/auth-events.service';
import type { MembershipEntity } from '../entities/membership.entity';
import type { RoleEntity } from '../entities/role.entity';
import type { MembershipRepository } from '../repositories/membership.repository';
import type { RoleRepository } from '../repositories/role.repository';
import { TenantGuard } from './tenant.guard';

interface BuildContextOptions {
  readonly currentUser?: CurrentUserContext;
  readonly contextBag?: Partial<RequestContext>;
  readonly type?: 'http' | 'rpc';
}

interface Mocks {
  memberships: jest.Mocked<MembershipRepository>;
  roles: jest.Mocked<RoleRepository>;
  authEvents: jest.Mocked<AuthEventsService>;
}

function buildMocks(): Mocks {
  return {
    memberships: {
      findActiveByUserAndOrganization: jest.fn(),
    } as unknown as jest.Mocked<MembershipRepository>,
    roles: {
      findById: jest.fn(),
    } as unknown as jest.Mocked<RoleRepository>,
    authEvents: {
      record: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<AuthEventsService>,
  };
}

function buildExecutionContext(options: BuildContextOptions = {}): {
  ctx: ExecutionContext;
  req: Request & { context?: RequestContext };
} {
  const contextBag: RequestContext = {
    ...(options.contextBag ?? {}),
    ...(options.currentUser !== undefined ? { currentUser: options.currentUser } : {}),
  };
  const req = { context: contextBag } as unknown as Request & { context?: RequestContext };
  const handler = (): void => undefined;
  class FakeController {}
  const ctx = {
    getType: () => options.type ?? 'http',
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

describe('TenantGuard (BE-RBAC-02)', () => {
  it('binds the verified org context on success', async () => {
    const mocks = buildMocks();
    mocks.memberships.findActiveByUserAndOrganization.mockResolvedValue({
      id: 'm_1',
      roleId: 'r_admin_id',
    } as MembershipEntity);
    mocks.roles.findById.mockResolvedValue({
      id: 'r_admin_id',
      code: 'admin',
    } as RoleEntity);
    const guard = new TenantGuard(mocks.memberships, mocks.roles, mocks.authEvents);
    const { ctx, req } = buildExecutionContext({
      currentUser: { id: 'u_1', mfaVerified: true, tokenOrgId: 'org-42' },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.context?.currentOrg).toEqual({
      id: 'org-42',
      roleId: 'r_admin_id',
      role: 'admin',
      membershipId: 'm_1',
    });
    expect(mocks.authEvents.record).not.toHaveBeenCalled();
  });

  it('throws AUTH_INVALID_TOKEN when JwtAuthGuard was forgotten upstream', async () => {
    const mocks = buildMocks();
    const guard = new TenantGuard(mocks.memberships, mocks.roles, mocks.authEvents);
    const { ctx } = buildExecutionContext(); // no currentUser

    try {
      await guard.canActivate(ctx);
      fail('should have thrown');
    } catch (error: unknown) {
      expect(AppException.isAppException(error)).toBe(true);
      expect((error as AppException).code).toBe(ERROR_CODES.AUTH_INVALID_TOKEN);
    }
  });

  it('throws ORG_NOT_FOUND (404, not 403) when the token has no org_id claim', async () => {
    const mocks = buildMocks();
    const guard = new TenantGuard(mocks.memberships, mocks.roles, mocks.authEvents);
    const { ctx } = buildExecutionContext({
      currentUser: { id: 'u_1', mfaVerified: false }, // no tokenOrgId
    });

    try {
      await guard.canActivate(ctx);
      fail('should have thrown');
    } catch (error: unknown) {
      expect((error as AppException).code).toBe(ERROR_CODES.ORG_NOT_FOUND);
      expect((error as AppException).status).toBe(404);
    }
    expect(mocks.authEvents.record).not.toHaveBeenCalled();
  });

  it('throws ORG_NOT_FOUND + emits auth.cross_tenant_attempt when no active membership exists', async () => {
    const mocks = buildMocks();
    mocks.memberships.findActiveByUserAndOrganization.mockResolvedValue(null);
    const guard = new TenantGuard(mocks.memberships, mocks.roles, mocks.authEvents);
    const { ctx } = buildExecutionContext({
      currentUser: { id: 'attacker_u', mfaVerified: true, tokenOrgId: 'org-victim' },
      contextBag: { ip: '198.51.100.4', userAgent: 'curl/8.0' },
    });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      code: ERROR_CODES.ORG_NOT_FOUND,
      status: 404,
    });

    expect(mocks.authEvents.record).toHaveBeenCalledTimes(1);
    const [eventType, eventContext, metadata] = mocks.authEvents.record.mock.calls[0]!;
    expect(eventType).toBe('auth.cross_tenant_attempt');
    expect(eventContext).toMatchObject({
      userId: 'attacker_u',
      organizationId: 'org-victim',
      ipAddress: '198.51.100.4',
      userAgent: 'curl/8.0',
    });
    expect(metadata).toEqual({ attemptedOrgId: 'org-victim' });
  });

  it('fails closed when the membership row references a missing role (data integrity)', async () => {
    const mocks = buildMocks();
    mocks.memberships.findActiveByUserAndOrganization.mockResolvedValue({
      id: 'm_1',
      roleId: 'r_ghost',
    } as MembershipEntity);
    mocks.roles.findById.mockResolvedValue(null);
    const guard = new TenantGuard(mocks.memberships, mocks.roles, mocks.authEvents);
    const { ctx } = buildExecutionContext({
      currentUser: { id: 'u_1', mfaVerified: true, tokenOrgId: 'org-1' },
    });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      code: ERROR_CODES.ORG_NOT_FOUND,
    });
  });

  it('passes through non-HTTP contexts without DB calls', async () => {
    const mocks = buildMocks();
    const guard = new TenantGuard(mocks.memberships, mocks.roles, mocks.authEvents);
    const { ctx } = buildExecutionContext({ type: 'rpc' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mocks.memberships.findActiveByUserAndOrganization).not.toHaveBeenCalled();
  });
});
