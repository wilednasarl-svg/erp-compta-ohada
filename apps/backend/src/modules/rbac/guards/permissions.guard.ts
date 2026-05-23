import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { RequestContext } from '../../../common/types/request-context';
import { REQUIRE_PERMISSION_METADATA_KEY } from '../decorators/require-permission.decorator';
import { RolePermissionRepository } from '../repositories/role-permission.repository';

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
 * The repository call hits Postgres once per request. A caching layer
 * (per-role permission set, invalidated on role-matrix changes) is the
 * obvious next step but out of scope for Module 1 — the matrix is small
 * (16 codes × 6 roles) and a single indexed lookup costs sub-millisecond.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rolePermissions: RolePermissionRepository,
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

    const allowed = await this.rolePermissions.roleHasPermission(currentOrg.roleId, requiredCode);
    if (!allowed) {
      throw new AppException(ERROR_CODES.FORBIDDEN_PERMISSION, {
        message: `Caller role does not grant '${requiredCode}'`,
        details: { role: currentOrg.role, permission: requiredCode },
      });
    }

    return true;
  }
}
