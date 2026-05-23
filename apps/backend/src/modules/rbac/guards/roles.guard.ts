import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { RequestContext } from '../../../common/types/request-context';
import { ROLES_METADATA_KEY } from '../decorators/roles.decorator';

/**
 * `RolesGuard` (BE-RBAC-03) — opt-in role allow-list.
 *
 * Reads the `@Roles(...codes)` metadata; if none is set, the guard
 * allows (this matches the spec's "simple-cases-only" intent and
 * leaves the deny-by-default stance to `PermissionsGuard`).
 *
 * When a list is set:
 *   - Missing `currentOrg` (TenantGuard not composed) → 403
 *     `FORBIDDEN_NO_MEMBERSHIP`. The route asked for a role-gated
 *     check without a tenant context, which makes no sense.
 *   - Role code not in the allow-list → 403 `FORBIDDEN_ROLE`.
 *   - Role code in the allow-list → allow.
 *
 * The empty array `@Roles()` is treated as "never allow", which is a
 * deliberate fail-closed for the unusual but possible "deactivate this
 * route without removing it" use case.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    const allowed = this.reflector.getAllAndOverride<ReadonlyArray<string> | undefined>(
      ROLES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed === undefined) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { context?: RequestContext }>();
    const currentOrg = req.context?.currentOrg;

    if (currentOrg === undefined) {
      throw new AppException(ERROR_CODES.FORBIDDEN_NO_MEMBERSHIP, {
        message: 'RolesGuard requires TenantGuard upstream — no currentOrg bound',
      });
    }

    if (!allowed.includes(currentOrg.role)) {
      throw new AppException(ERROR_CODES.FORBIDDEN_ROLE, {
        message: 'Caller role is not allowed on this endpoint',
        details: { role: currentOrg.role, allowed: [...allowed] },
      });
    }

    return true;
  }
}
