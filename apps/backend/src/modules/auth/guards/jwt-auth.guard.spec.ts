import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { RequestContext } from '../../../common/types/request-context';
import { IS_PUBLIC_METADATA_KEY } from '../decorators/public.decorator';
import type { AccessTokenClaims } from '../config/jwt.config';
import type { JwtTokenService } from '../services/jwt-token.service';
import { JwtAuthGuard } from './jwt-auth.guard';

interface BuildContextOptions {
  readonly authorization?: string;
  readonly contextBag?: RequestContext;
  readonly type?: 'http' | 'rpc' | 'ws' | 'graphql';
}

function buildExecutionContext(options: BuildContextOptions = {}): {
  ctx: ExecutionContext;
  req: Request & { context?: RequestContext };
} {
  const headers: Record<string, string> = {};
  if (options.authorization !== undefined) {
    headers.authorization = options.authorization;
  }
  const req = { headers, context: options.contextBag } as unknown as Request & {
    context?: RequestContext;
  };
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

function buildJwt(verify: jest.Mock = jest.fn()): JwtTokenService {
  return { verifyAccessToken: verify } as unknown as JwtTokenService;
}

describe('JwtAuthGuard (BE-RBAC-01)', () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
  });

  function makeClaims(overrides: Partial<AccessTokenClaims> = {}): AccessTokenClaims {
    return {
      sub: 'u_1',
      purpose: 'access',
      iat: 1,
      exp: 2,
      iss: 'erp-compta-auth',
      ...overrides,
    } as AccessTokenClaims;
  }

  it('binds the verified principal onto req.context.currentUser on success', () => {
    const verify = jest.fn().mockReturnValue(makeClaims({ mfa_verified: true }));
    const guard = new JwtAuthGuard(reflector, buildJwt(verify));
    const { ctx, req } = buildExecutionContext({ authorization: 'Bearer good-token' });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(verify).toHaveBeenCalledWith('good-token');
    expect(req.context?.currentUser).toEqual({ id: 'u_1', mfaVerified: true });
  });

  it('defaults mfaVerified to false when the claim is absent', () => {
    const verify = jest.fn().mockReturnValue(makeClaims({ sub: 'u_2' }));
    const guard = new JwtAuthGuard(reflector, buildJwt(verify));
    const { ctx, req } = buildExecutionContext({ authorization: 'Bearer t' });

    guard.canActivate(ctx);

    expect(req.context?.currentUser).toEqual({ id: 'u_2', mfaVerified: false });
  });

  it('mirrors the org_id claim onto currentUser.tokenOrgId (raw, not yet membership-verified)', () => {
    const verify = jest.fn().mockReturnValue(makeClaims({ sub: 'u_3', org_id: 'org-42' }));
    const guard = new JwtAuthGuard(reflector, buildJwt(verify));
    const { ctx, req } = buildExecutionContext({ authorization: 'Bearer t' });

    guard.canActivate(ctx);

    expect(req.context?.currentUser).toEqual({
      id: 'u_3',
      mfaVerified: false,
      tokenOrgId: 'org-42',
    });
  });

  it('preserves an existing context bag (requestId / ip / userAgent) when binding the user', () => {
    const verify = jest.fn().mockReturnValue({ sub: 'u_3', iat: 1, exp: 2 });
    const guard = new JwtAuthGuard(reflector, buildJwt(verify));
    const { ctx, req } = buildExecutionContext({
      authorization: 'Bearer t',
      contextBag: { requestId: 'req-abc', ip: '203.0.113.7', userAgent: 'jest' },
    });

    guard.canActivate(ctx);

    expect(req.context).toMatchObject({
      requestId: 'req-abc',
      ip: '203.0.113.7',
      userAgent: 'jest',
      currentUser: { id: 'u_3', mfaVerified: false },
    });
  });

  it('throws AUTH_INVALID_TOKEN when the Authorization header is missing', () => {
    const guard = new JwtAuthGuard(reflector, buildJwt());
    const { ctx } = buildExecutionContext();

    try {
      guard.canActivate(ctx);
      fail('should have thrown');
    } catch (error: unknown) {
      expect(AppException.isAppException(error)).toBe(true);
      expect((error as AppException).code).toBe(ERROR_CODES.AUTH_INVALID_TOKEN);
      expect((error as AppException).status).toBe(401);
    }
  });

  it('throws AUTH_INVALID_TOKEN when the scheme is not Bearer', () => {
    const guard = new JwtAuthGuard(reflector, buildJwt());
    const { ctx } = buildExecutionContext({ authorization: 'Basic dXNlcjpwYXNz' });

    expect(() => guard.canActivate(ctx)).toThrow(AppException);
  });

  it('throws AUTH_INVALID_TOKEN when the Bearer prefix has no token', () => {
    const guard = new JwtAuthGuard(reflector, buildJwt());
    const { ctx } = buildExecutionContext({ authorization: 'Bearer   ' });

    expect(() => guard.canActivate(ctx)).toThrow(AppException);
  });

  it('propagates the AUTH_INVALID_TOKEN thrown by JwtTokenService.verify (expired, tampered, …)', () => {
    const verify = jest.fn().mockImplementation(() => {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, { message: 'expired' });
    });
    const guard = new JwtAuthGuard(reflector, buildJwt(verify));
    const { ctx } = buildExecutionContext({ authorization: 'Bearer expired' });

    expect(() => guard.canActivate(ctx)).toThrow(AppException);
  });

  it('skips verification entirely when @Public() metadata is set on the handler', () => {
    const verify = jest.fn();
    const guard = new JwtAuthGuard(reflector, buildJwt(verify));
    const { ctx, req } = buildExecutionContext(); // no Authorization header at all

    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_METADATA_KEY) {
        return true;
      }
      return undefined;
    });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(verify).not.toHaveBeenCalled();
    expect(req.context?.currentUser).toBeUndefined();
  });

  it('passes through non-HTTP contexts without touching the request', () => {
    const verify = jest.fn();
    const guard = new JwtAuthGuard(reflector, buildJwt(verify));
    const { ctx } = buildExecutionContext({ type: 'rpc' });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });
});
