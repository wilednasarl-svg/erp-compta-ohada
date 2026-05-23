import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { RequestContext } from '../../../common/types/request-context';
import { REQUIRE_PERMISSION_METADATA_KEY } from '../decorators/require-permission.decorator';
import { PermissionsCacheService } from '../services/permissions-cache.service';

/**
 * `PermissionsGuard` (BE-RBAC-04) — DENY-BY-DEFAULT permission check
 * against the seeded `role × permission` matrix.
 *
 * Pipeline:
 *   1. `@RequirePermission(code)` MUST be present. If missing →
 *      `RBAC_NO_POLICY_DECLARED` (403). The fail-closed stance means a
 *      controller author who forgets the annotation gets a loud failure
 *      from the very first request, rather than silently opening a
 *      privileged endpoint.
 *   2. `currentOrg` MUST be bound (TenantGuard upstream). Missing →
 *      `FORBIDDEN_NO_MEMBERSHIP` (403).
 *   3. Look up the matrix via
 *      `RolePermissionRepository.roleHasPermission(roleId, code)`.
 *      Allow on `true`; `FORBIDDEN_PERMISSION` (403) on `false`.
 *
 * The matrix lookup goes through `PermissionsCacheService` (BE-RBAC-09)
 * — first hit per role triggers one Postgres round-trip, subsequent
 * hits resolve from an in-memory `Set<code>`. The cache is process-
 * local; a future admin endpoint that mutates `role_permissions` must
 * call `invalidateRole(roleId)` on the same Nest instance (or push to
 * a shared bus when the platform scales horizontally).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsCache: PermissionsCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }

    const requiredCode = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRE_PERMISSION_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredCode === undefined) {
      throw new AppException(ERROR_CODES.RBAC_NO_POLICY_DECLARED, {
        message: 'Handler is missing a @RequirePermission(code) annotation',
      });
    }

    const req = context.switchToHttp().getRequest<Request & { context?: RequestContext }>();
    const currentOrg = req.context?.currentOrg;
    if (currentOrg === undefined) {
      throw new AppException(ERROR_CODES.FORBIDDEN_NO_MEMBERSHIP, {
        message: 'PermissionsGuard requires TenantGuard upstream — no currentOrg bound',
      });
    }

    const allowed = await this.permissionsCache.roleHasPermission(currentOrg.roleId, requiredCode);
    if (!allowed) {
      throw new AppException(ERROR_CODES.FORBIDDEN_PERMISSION, {
        message: `Caller role does not grant '${requiredCode}'`,
        details: { role: currentOrg.role, permission: requiredCode },
      });
    }

    return true;
  }
}
