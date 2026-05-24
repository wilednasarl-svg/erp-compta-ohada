import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { MembershipEntity, type MembershipStatus } from '../entities/membership.entity';

/**
 * `MembershipRepository` (BE-DB-11) — tenant-scoped data access for
 * `memberships` (which carries `organization_id`).
 *
 * Invariant: every public method that reads or mutates this table requires
 * an `organizationId` parameter. The `TenantId` brand makes a missing
 * scope a compile-time error; `assertTenantId` rejects empty values at
 * runtime so an upstream bug (e.g. an undefined claim) fails fast at the
 * boundary instead of silently leaking across tenants.
 *
 * Note: `listOrganizationsForUser(userId)` is the ONE method that does NOT
 * take `organizationId` — it is the "which orgs does this user belong to"
 * lookup used by `POST /auth/login` before the user has selected an
 * organization. It still scopes by `userId`, so a row from another user's
 * membership cannot leak.
 */
@Injectable()
export class MembershipRepository {
  constructor(
    @InjectRepository(MembershipEntity)
    private readonly repo: Repository<MembershipEntity>,
  ) {}

  async findActiveByUserAndOrganization(
    userId: string,
    organizationId: TenantId | string,
  ): Promise<MembershipEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: { userId, organizationId, status: 'active' },
    });
  }

  /**
   * Same as `findActiveByUserAndOrganization` but eager-loads the
   * `organization` relation. Used by `AuthService.selectOrganization`
   * to resolve tenant name in one round-trip without injecting
   * `OrganizationRepository` (which would force a forwardRef cycle
   * between AuthModule and OrganizationsModule).
   */
  async findActiveByUserAndOrganizationWithOrg(
    userId: string,
    organizationId: TenantId | string,
  ): Promise<MembershipEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: { userId, organizationId, status: 'active' },
      relations: { organization: true },
    });
  }

  async findByUserAndOrganization(
    userId: string,
    organizationId: TenantId | string,
  ): Promise<MembershipEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { userId, organizationId } });
  }

  async listActiveByOrganization(organizationId: TenantId | string): Promise<MembershipEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, status: 'active' },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Same as `listActiveByOrganization` but loads the `user` + `role`
   * relations needed by the members view (BE-ORG-07). Kept as a separate
   * method so the bare lookup stays cheap.
   */
  async listActiveByOrganizationWithRelations(
    organizationId: TenantId | string,
  ): Promise<MembershipEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, status: 'active' },
      relations: { user: true, role: true },
      order: { createdAt: 'ASC' },
    });
  }

  async countActiveAdminsForOrganization(
    organizationId: TenantId | string,
    adminRoleId: string,
  ): Promise<number> {
    assertTenantId(organizationId);
    return this.repo.count({
      where: { organizationId, roleId: adminRoleId, status: 'active' },
    });
  }

  /**
   * "Which organizations does this user belong to?" — used by login to
   * populate the org selector. Scoped by `userId` only; a row from another
   * user cannot leak.
   */
  async listOrganizationsForUser(userId: string): Promise<MembershipEntity[]> {
    return this.repo.find({
      where: { userId, status: 'active' },
      relations: { organization: true, role: true },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Create a membership row. `manager` lets the caller join an outer
   * transaction (e.g. `OrganizationsService.create` which bundles org +
   * membership + accounting config + chart clone in a single
   * transaction). Without `manager`, a standalone insert runs.
   */
  async create(
    input: {
      userId: string;
      organizationId: TenantId | string;
      roleId: string;
      status?: MembershipStatus;
    },
    manager?: EntityManager,
  ): Promise<MembershipEntity> {
    assertTenantId(input.organizationId);
    const repo = manager !== undefined ? manager.getRepository(MembershipEntity) : this.repo;
    const entity = repo.create({
      userId: input.userId,
      organizationId: input.organizationId,
      roleId: input.roleId,
      status: input.status ?? 'active',
    });
    return repo.save(entity);
  }

  async updateRole(
    userId: string,
    organizationId: TenantId | string,
    roleId: string,
  ): Promise<void> {
    assertTenantId(organizationId);
    await this.repo.update({ userId, organizationId }, { roleId });
  }

  async updateStatus(
    userId: string,
    organizationId: TenantId | string,
    status: MembershipStatus,
  ): Promise<void> {
    assertTenantId(organizationId);
    await this.repo.update({ userId, organizationId }, { status });
  }

  async remove(userId: string, organizationId: TenantId | string): Promise<void> {
    assertTenantId(organizationId);
    await this.repo.delete({ userId, organizationId });
  }

  /**
   * Atomic "change role unless this is the last active admin".
   *
   * The TOCTOU between `countActiveAdminsForOrganization` and a separate
   * `updateRole` allows two concurrent admin-downgrade requests to both
   * read `count = 2`, both pass the check, and both commit — leaving
   * zero admins. This single statement closes that race by:
   *
   *   1. Locking ALL active admin rows for the org (`SELECT … FOR UPDATE`)
   *      inside a CTE. Concurrent transactions performing the same lock
   *      block until ours commits.
   *   2. Running the UPDATE only if the locked-and-counted admin count
   *      is strictly greater than 1 (i.e. the target is NOT the only
   *      admin), OR if we are not stripping admin status (downgrade
   *      condition is false).
   *
   * The whole statement runs as a single implicit transaction; if the
   * UPDATE affects 0 rows the caller treats it as a last-admin block
   * and throws `ORG_LAST_ADMIN`.
   *
   * Returns the number of affected rows (0 = blocked or row not found,
   * 1 = updated).
   */
  async updateRoleIfNotLastAdmin(args: {
    userId: string;
    organizationId: TenantId | string;
    newRoleId: string;
    /** Set when downgrading admin → non-admin; null otherwise. */
    fromAdminRoleId: string | null;
  }): Promise<number> {
    assertTenantId(args.organizationId);
    if (args.fromAdminRoleId === null) {
      // Non-downgrade path: regular update, no race to defend against.
      const r = await this.repo.update(
        { userId: args.userId, organizationId: args.organizationId },
        { roleId: args.newRoleId },
      );
      return r.affected ?? 0;
    }
    const result: any = await this.repo.query(
      `WITH locked_admins AS (
         SELECT id FROM memberships
         WHERE organization_id = $1
           AND role_id = $2
           AND status = 'active'
         FOR UPDATE
       )
       UPDATE memberships
       SET role_id = $3, updated_at = now()
       WHERE user_id = $4
         AND organization_id = $1
         AND (SELECT count(*) FROM locked_admins) > 1
       RETURNING id`,
      [args.organizationId, args.fromAdminRoleId, args.newRoleId, args.userId],
    );
    if (Array.isArray(result)) {
      if (result.length === 2 && typeof result[1] === 'number' && Array.isArray(result[0])) {
        return result[1];
      }
      return result.length;
    }
    return result ? 1 : 0;
  }

  /**
   * Atomic "remove member unless they are the last active admin".
   * Same locking pattern as `updateRoleIfNotLastAdmin` — locks the
   * org's active admin rows in a CTE before the DELETE so the count
   * check is consistent with the eventual deletion.
   *
   * `adminRoleIdIfAdmin` is `null` when the target is not an admin
   * (no guard needed) and the admin role id otherwise. Returns the
   * number of affected rows (0 = blocked or row not found, 1 = deleted).
   */
  async removeIfNotLastAdmin(args: {
    userId: string;
    organizationId: TenantId | string;
    adminRoleIdIfAdmin: string | null;
  }): Promise<number> {
    assertTenantId(args.organizationId);
    if (args.adminRoleIdIfAdmin === null) {
      const r = await this.repo.delete({
        userId: args.userId,
        organizationId: args.organizationId,
      });
      return r.affected ?? 0;
    }
    const result: any = await this.repo.query(
      `WITH locked_admins AS (
         SELECT id FROM memberships
         WHERE organization_id = $1
           AND role_id = $2
           AND status = 'active'
         FOR UPDATE
       )
       DELETE FROM memberships
       WHERE user_id = $3
         AND organization_id = $1
         AND (SELECT count(*) FROM locked_admins) > 1
       RETURNING id`,
      [args.organizationId, args.adminRoleIdIfAdmin, args.userId],
    );
    if (Array.isArray(result)) {
      if (result.length === 2 && typeof result[1] === 'number' && Array.isArray(result[0])) {
        return result[1];
      }
      return result.length;
    }
    return result ? 1 : 0;
  }
}
