import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { InvitationEntity, type InvitationStatus } from '../entities/invitation.entity';

/**
 * `InvitationRepository` (BE-DB-11) — tenant-scoped data access for
 * `invitations` (which carries `organization_id`).
 *
 * Invariant: every public method that reads or mutates this table requires
 * an `organizationId` parameter. The `TenantId` brand makes a missing scope
 * a compile-time error; `assertTenantId` rejects empty/whitespace values
 * at runtime so that an upstream bug fails fast at the boundary instead
 * of silently leaking across tenants. There is no public `findById(id)`
 * that omits the scope.
 *
 * `findActiveByTokenHash` is the only read by `token_hash` and intentionally
 * still requires the scope — the caller must derive the org from the JWT or
 * an explicit URL segment, not blindly trust the token.
 */
@Injectable()
export class InvitationRepository {
  constructor(
    @InjectRepository(InvitationEntity)
    private readonly repo: Repository<InvitationEntity>,
  ) {}

  async findById(id: string, organizationId: TenantId | string): Promise<InvitationEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findPendingByEmail(
    email: string,
    organizationId: TenantId | string,
  ): Promise<InvitationEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: { email, organizationId, status: 'pending' },
    });
  }

  async listByStatus(
    organizationId: TenantId | string,
    status: InvitationStatus,
  ): Promise<InvitationEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({ where: { organizationId, status }, order: { createdAt: 'DESC' } });
  }

  async findActiveByTokenHash(
    tokenHash: string,
    organizationId: TenantId | string,
  ): Promise<InvitationEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: { tokenHash, organizationId, status: 'pending' },
    });
  }

  async create(
    organizationId: TenantId | string,
    input: {
      email: string;
      roleId: string;
      tokenHash: string;
      invitedBy: string;
      expiresAt: Date;
    },
  ): Promise<InvitationEntity> {
    assertTenantId(organizationId);
    const entity = this.repo.create({
      organizationId,
      status: 'pending',
      ...input,
    });
    return this.repo.save(entity);
  }

  async markAccepted(
    id: string,
    organizationId: TenantId | string,
    acceptedAt: Date,
  ): Promise<void> {
    assertTenantId(organizationId);
    await this.repo.update({ id, organizationId }, { status: 'accepted', acceptedAt });
  }

  /**
   * Patch the `token_hash` after the row is initially inserted.
   * `InvitationsService.create` uses a two-step persist: insert first to
   * obtain a stable `id` (referenced in the JWT `invitation_id` claim),
   * then patch with the SHA-256 hash of the signed token once the JWT is
   * minted. Scoped by `(id, organizationId)` so a cross-tenant patch is
   * impossible.
   */
  async updateTokenHash(
    id: string,
    organizationId: TenantId | string,
    tokenHash: string,
  ): Promise<void> {
    assertTenantId(organizationId);
    await this.repo.update({ id, organizationId }, { tokenHash });
  }

  async markRevoked(id: string, organizationId: TenantId | string): Promise<void> {
    assertTenantId(organizationId);
    await this.repo.update({ id, organizationId }, { status: 'revoked' });
  }

  async markExpired(id: string, organizationId: TenantId | string): Promise<void> {
    assertTenantId(organizationId);
    await this.repo.update({ id, organizationId }, { status: 'expired' });
  }
}
