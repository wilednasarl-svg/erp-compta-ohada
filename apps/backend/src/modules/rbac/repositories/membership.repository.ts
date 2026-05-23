import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

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

  async create(input: {
    userId: string;
    organizationId: TenantId | string;
    roleId: string;
    status?: MembershipStatus;
  }): Promise<MembershipEntity> {
    assertTenantId(input.organizationId);
    const entity = this.repo.create({
      userId: input.userId,
      organizationId: input.organizationId,
      roleId: input.roleId,
      status: input.status ?? 'active',
    });
    return this.repo.save(entity);
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
}
