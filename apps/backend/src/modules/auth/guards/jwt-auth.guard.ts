import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { RequestContext } from '../../../common/types/request-context';
import { IS_PUBLIC_METADATA_KEY } from '../decorators/public.decorator';
import { JwtTokenService } from '../services/jwt-token.service';

const BEARER_PREFIX = 'Bearer ';

/**
 * `JwtAuthGuard` (BE-RBAC-01) — extracts the `Authorization: Bearer …`
 * header, verifies the access token through `JwtTokenService`, and binds
 * the principal to `req.context.currentUser` for downstream consumers
 * (`@CurrentUser()`, `TenantGuard`, controllers).
 *
 * Failure modes all surface as `AppException(AUTH_INVALID_TOKEN, 401)`:
 *
 *   - missing header,
 *   - wrong scheme (anything other than literal "Bearer "),
 *   - empty token after the prefix,
 *   - any verification failure (`JwtTokenService.verifyAccessToken`
 *     already throws this same code; we just re-let it propagate).
 *
 * The guard intentionally does NOT enforce `mfa_verified`. A controller
 * that gates an MFA-required operation should compose a dedicated guard
 * (BE-AUTH-MFA-VERIFIED) — leaving this guard purely about "is the token
 * cryptographically valid" keeps the responsibilities single-purpose.
 *
 * Opt-out: any handler / controller annotated `@Public()` bypasses the
 * guard entirely (used by `/health/db`, `/auth/login`, etc.).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtTokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      // The JWT scheme is HTTP-specific. RPC / WS / GraphQL contexts must
      // wire their own auth — we pass through rather than fail closed,
      // matching the response-envelope interceptor's policy (BE-BOOT-07).
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { context?: RequestContext }>();
    const token = this.extractBearerToken(req);
    const claims = this.jwt.verifyAccessToken(token);

    const ctxBag: RequestContext = req.context ?? {};
    ctxBag.currentUser = {
      id: claims.sub,
      mfaVerified: claims.mfa_verified === true,
      ...(typeof claims.org_id === 'string' && claims.org_id.length > 0
        ? { tokenOrgId: claims.org_id }
        : {}),
    };
    req.context = ctxBag;

    return true;
  }

  private extractBearerToken(req: Request): string {
    const raw = req.headers.authorization;
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authorization header is missing',
      });
    }
    if (!raw.startsWith(BEARER_PREFIX)) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authorization header must use the Bearer scheme',
      });
    }
    const token = raw.slice(BEARER_PREFIX.length).trim();
    if (token.length === 0) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Bearer token is empty',
      });
    }
    return token;
  }
}
