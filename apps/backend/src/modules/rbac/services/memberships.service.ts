import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { AuthEventsService } from '../../audit/services/auth-events.service';
import type { AuthEventContext } from '../../audit/services/auth-events.service';
import { MembershipRepository } from '../repositories/membership.repository';
import { RoleRepository } from '../repositories/role.repository';

/**
 * Public projection of a member row, returned by both `listMembers` and
 * `changeRole`. Kept stable and DB-shape-independent so the wire contract
 * survives entity refactors.
 */
export interface MemberView {
  readonly userId: string;
  readonly email: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly role: string;
  readonly status: 'active' | 'suspended';
}

/**
 * `MembershipsService` (BE-ORG-07..08 + spec 7.7) — orchestrates the two
 * member-management endpoints:
 *
 *   - `listMembers(orgId)` — read view fed into
 *     `GET /organizations/:id/members`, gated by
 *     `@RequirePermission('organizations.read')`.
 *   - `changeRole(actor, orgId, target, newRoleCode)` — admin-only
 *     mutation behind `@RequirePermission('organizations.manage_members')`.
 *     Enforces the "at least one active admin per organization" invariant
 *     (spec 7.7): a downgrade that would leave the org adminless is
 *     rejected with `ORG_LAST_ADMIN` (409).
 *
 * Audit:
 *   - successful role changes emit `organizations.role_changed` with
 *     `{ targetUserId, fromRole, toRole }` so an admin can rebuild the
 *     governance history of any org from the journal alone.
 *
 * The service depends on `MembershipRepository` + `RoleRepository`
 * (catalog lookups by code or id) + `AuthEventsService` (swallow-and-warn
 * journal). No tenant-id branding on the public surface here: callers
 * pass plain strings; the repository layer (`assertTenantId`) is the
 * single boundary that enforces the brand.
 */
@Injectable()
export class MembershipsService {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly roles: RoleRepository,
    private readonly audit: AuthEventsService,
  ) {}

  async listMembers(organizationId: string): Promise<ReadonlyArray<MemberView>> {
    const rows = await this.memberships.listActiveByOrganizationWithRelations(organizationId);
    const view: MemberView[] = [];
    for (const row of rows) {
      if (row.user === undefined || row.role === undefined) {
        continue;
      }
      view.push({
        userId: row.user.id,
        email: row.user.email,
        firstName: row.user.firstName,
        lastName: row.user.lastName,
        role: row.role.code,
        status: row.status,
      });
    }
    return view;
  }

  async changeRole(
    actorUserId: string,
    organizationId: string,
    targetUserId: string,
    newRoleCode: string,
    context: AuthEventContext,
  ): Promise<MemberView> {
    const targetMembership = await this.memberships.findByUserAndOrganization(
      targetUserId,
      organizationId,
    );
    if (targetMembership === null) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Target user has no membership on this organization',
      });
    }

    const [newRole, oldRole] = await Promise.all([
      this.roles.findByCode(newRoleCode),
      this.roles.findById(targetMembership.roleId),
    ]);
    if (newRole === null) {
      // Unknown role code. The DTO already restricts to the seeded list,
      // but a future code added to the catalog without updating the DTO
      // would land here as 404 rather than a silent allow.
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: `Role '${newRoleCode}' is not part of the catalog`,
      });
    }
    if (oldRole === null) {
      // Data integrity — RESTRICT FK should make this impossible.
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Membership role is unresolvable',
      });
    }

    if (oldRole.code === newRole.code) {
      // No-op assignment. Skip the audit write to avoid noise; return the
      // current state verbatim.
      return this.toView(targetMembership, newRole.code);
    }

    // Last-admin invariant (spec 7.7): refuse to downgrade the only
    // active admin remaining. Single SQL statement with `SELECT … FOR
    // UPDATE` on the admin rows so two concurrent downgrade requests
    // serialise instead of both passing a stale `count = 2` and leaving
    // zero admins. `updateRoleIfNotLastAdmin` returns 0 when the guard
    // blocks (or when the membership row vanished); we surface the
    // former as `ORG_LAST_ADMIN`.
    const downgradingAdmin = oldRole.code === 'admin' && newRole.code !== 'admin';
    const affected = await this.memberships.updateRoleIfNotLastAdmin({
      userId: targetUserId,
      organizationId,
      newRoleId: newRole.id,
      fromAdminRoleId: downgradingAdmin ? oldRole.id : null,
    });
    if (affected === 0) {
      if (downgradingAdmin) {
        throw new AppException(ERROR_CODES.ORG_LAST_ADMIN, {
          message: 'Cannot downgrade the last active admin of the organization',
          details: { organizationId, targetUserId },
        });
      }
      // The membership row disappeared between our initial read and
      // the update — surface a clean 404 rather than silently no-oping.
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Target user has no membership on this organization',
      });
    }
    await this.audit.record(
      'organizations.role_changed',
      {
        ...context,
        userId: actorUserId,
        organizationId,
      },
      {
        targetUserId,
        fromRole: oldRole.code,
        toRole: newRole.code,
      },
    );

    return this.toView(targetMembership, newRole.code);
  }

  /**
   * BE-ORG-07 — admin-only member removal. Same last-admin invariant as
   * `changeRole` (spec 7.7): refuse to remove the only active admin
   * remaining. Emits `organizations.role_changed` with `{ targetUserId,
   * fromRole, toRole: null, action: 'removed' }` so the journal can
   * reconstruct the full membership history.
   *
   * The repository delete is hard (FK CASCADE), not a soft-delete: the
   * `memberships` table has no `deleted_at` column. If the spec ever
   * needs a "suspended" tombstone, prefer `changeRole`/`updateStatus`
   * which already exist.
   */
  async removeMember(
    actorUserId: string,
    organizationId: string,
    targetUserId: string,
    context: AuthEventContext,
  ): Promise<void> {
    const targetMembership = await this.memberships.findByUserAndOrganization(
      targetUserId,
      organizationId,
    );
    if (targetMembership === null) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Target user has no membership on this organization',
      });
    }

    const targetRole = await this.roles.findById(targetMembership.roleId);
    if (targetRole === null) {
      // Data integrity — RESTRICT FK should make this impossible.
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Membership role is unresolvable',
      });
    }

    // Last-admin invariant: lock-and-count inside a single DELETE so
    // two concurrent removes can't both pass `count = 2` and leave
    // zero admins. `removeIfNotLastAdmin` returns 0 when the guard
    // blocks (or when the row vanished); we map the former to
    // `ORG_LAST_ADMIN`.
    const targetIsAdmin = targetRole.code === 'admin';
    const affected = await this.memberships.removeIfNotLastAdmin({
      userId: targetUserId,
      organizationId,
      adminRoleIdIfAdmin: targetIsAdmin ? targetRole.id : null,
    });
    if (affected === 0) {
      if (targetIsAdmin) {
        throw new AppException(ERROR_CODES.ORG_LAST_ADMIN, {
          message: 'Cannot remove the last active admin of the organization',
          details: { organizationId, targetUserId },
        });
      }
      // Row vanished between read and delete — clean 404.
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Target user has no membership on this organization',
      });
    }
    await this.audit.record(
      'organizations.role_changed',
      {
        ...context,
        userId: actorUserId,
        organizationId,
      },
      {
        targetUserId,
        fromRole: targetRole.code,
        toRole: null,
        action: 'removed',
      },
    );
  }

  private toView(
    membership: { userId: string; status: 'active' | 'suspended' },
    roleCode: string,
  ): MemberView {
    return {
      userId: membership.userId,
      // The mutation path does not re-load the user; the controller
      // already has the actor's identity from the JWT, and the target
      // user's name/email are not part of the role-change response.
      email: null,
      firstName: null,
      lastName: null,
      role: roleCode,
      status: membership.status,
    };
  }
}
