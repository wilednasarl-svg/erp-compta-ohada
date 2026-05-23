import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { RequestContext } from '../../../common/types/request-context';
import { AuthEventsService } from '../../audit/services/auth-events.service';
import { MembershipRepository } from '../repositories/membership.repository';
import { RoleRepository } from '../repositories/role.repository';

/**
 * `TenantGuard` (BE-RBAC-02) — enforces the multi-tenant invariant on
 * every protected endpoint that touches tenant-scoped data.
 *
 * Preconditions:
 *   - `JwtAuthGuard` MUST run upstream: this guard reads
 *     `req.context.currentUser`.
 *
 * Flow:
 *   1. Missing `currentUser` → `AUTH_INVALID_TOKEN` (defensive — the
 *      composing route forgot to attach `JwtAuthGuard`).
 *   2. Token has no `org_id` claim → `ORG_NOT_FOUND`. We deliberately
 *      surface 404 (not 403) so an attacker probing for an organization
 *      they have no claim on cannot distinguish "does not exist" from
 *      "exists but I am not a member". The spec calls this out as the
 *      tenant-isolation acceptance criterion (`specs/auth/spec.md`).
 *   3. No active membership for (user, org) → same 404, plus an audit
 *      event `auth.cross_tenant_attempt` so an admin can correlate the
 *      attempt with the originating IP / user-agent.
 *   4. Happy path: load the role code from the membership and bind
 *      `currentOrg = { id, roleId, role, membershipId }` to the request
 *      context for downstream consumers (`@CurrentOrg`, RolesGuard,
 *      PermissionsGuard, controllers).
 *
 * Tenant routes obtain `org_id` exclusively from the JWT claim, never
 * from the URL/body. That keeps the guard the single source of truth and
 * removes a class of "I forgot to validate :orgId in the path" bugs.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly roles: RoleRepository,
    private readonly authEvents: AuthEventsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { context?: RequestContext }>();
    const ctxBag: RequestContext = req.context ?? {};
    const currentUser = ctxBag.currentUser;

    if (currentUser === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'TenantGuard requires JwtAuthGuard upstream — no currentUser bound',
      });
    }

    // `currentUser.tokenOrgId` is the raw `org_id` claim mirrored by
    // `JwtAuthGuard`. Missing claim means the user authenticated but
    // never called `POST /auth/select-organization` — for a tenant-
    // scoped route that is the same as "the org does not exist for me".
    const orgId = currentUser.tokenOrgId;
    if (orgId === undefined || orgId.length === 0) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Active organization is not selected for this session',
      });
    }

    const membership = await this.memberships.findActiveByUserAndOrganization(
      currentUser.id,
      orgId,
    );

    if (membership === null) {
      // Fire-and-forget audit. AuthEventsService swallows its own errors
      // so a flaky journal cannot turn a 404 into a 5xx.
      await this.authEvents.record(
        'auth.cross_tenant_attempt',
        {
          ipAddress: ctxBag.ip ?? null,
          userAgent: ctxBag.userAgent ?? null,
          userId: currentUser.id,
          organizationId: orgId,
        },
        { attemptedOrgId: orgId },
      );
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Active organization is not selected for this session',
      });
    }

    const role = await this.roles.findById(membership.roleId);
    if (role === null) {
      // A membership pointing at a missing role is a data-integrity bug
      // (RESTRICT FK should make it impossible). Fail closed.
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Membership role is unresolvable',
      });
    }

    ctxBag.currentOrg = {
      id: orgId,
      roleId: membership.roleId,
      role: role.code,
      membershipId: membership.id,
    };
    req.context = ctxBag;

    return true;
  }
}
