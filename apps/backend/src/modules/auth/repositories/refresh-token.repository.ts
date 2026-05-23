import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { RefreshTokenEntity } from '../entities/refresh-token.entity';

/**
 * `RefreshTokenRepository` (BE-DB-11) — data access for `refresh_tokens`.
 *
 * `organization_id` is nullable on this table (a freshly-logged-in user has
 * not yet selected an org), so it is NOT part of the always-required
 * scope. The primary scope here is `userId` (or `familyId` for revocations).
 * Tenant-scoped revocations live on a dedicated method that explicitly
 * requires `organizationId`.
 *
 * The repository never exposes the plaintext token — only the SHA-256
 * `tokenHash` returned by `RefreshTokenService` (BE-CRYPTO-04).
 */
@Injectable()
export class RefreshTokenRepository {
  constructor(
    @InjectRepository(RefreshTokenEntity)
    private readonly repo: Repository<RefreshTokenEntity>,
  ) {}

  async findByTokenHash(tokenHash: string): Promise<RefreshTokenEntity | null> {
    return this.repo.findOne({ where: { tokenHash } });
  }

  async findActiveByUser(userId: string): Promise<RefreshTokenEntity[]> {
    return this.repo.find({
      where: { userId, revokedAt: IsNull(), usedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async issue(input: {
    userId: string;
    organizationId: string | null;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
  }): Promise<RefreshTokenEntity> {
    const entity = this.repo.create({
      userId: input.userId,
      organizationId: input.organizationId,
      tokenHash: input.tokenHash,
      familyId: input.familyId,
      expiresAt: input.expiresAt,
      usedAt: null,
      revokedAt: null,
    });
    return this.repo.save(entity);
  }

  async markUsed(id: string, usedAt: Date): Promise<void> {
    await this.repo.update({ id }, { usedAt });
  }

  async revokeById(id: string, revokedAt: Date): Promise<void> {
    await this.repo.update({ id }, { revokedAt });
  }

  async revokeFamily(familyId: string, revokedAt: Date): Promise<void> {
    await this.repo.update({ familyId, revokedAt: IsNull() }, { revokedAt });
  }

  /**
   * Tenant-scoped revocation (e.g. admin removes a member; all their refresh
   * tokens for *that* organization must be invalidated, but their tokens
   * for other orgs must not). Explicitly requires `organizationId`.
   */
  async revokeForUserInOrganization(
    userId: string,
    organizationId: string,
    revokedAt: Date,
  ): Promise<void> {
    if (organizationId.trim().length === 0) {
      throw new Error(
        'Tenant scope violation: revokeForUserInOrganization requires a non-empty organizationId.',
      );
    }
    await this.repo.update({ userId, organizationId, revokedAt: IsNull() }, { revokedAt });
  }
}
