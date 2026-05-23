import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuthEventEntity, type AuthEventType } from '../entities/auth-event.entity';

/**
 * `AuthEventRepository` (BE-DB-11) — append-only writer + tenant-scoped
 * reader for `auth_events`.
 *
 * `organization_id` is nullable on this table (a failed login by an unknown
 * email has no org), so the *write* path accepts `null` and the global
 * "all events for user U" read also accepts a missing scope. The
 * tenant-scoped read (`listByOrganization`) explicitly requires
 * `organizationId` — used by admin audit views.
 *
 * Mutation/deletion is intentionally NOT supported. `specs/auth/spec.md`
 * mandates an immutable journal; if a row needs to disappear (GDPR
 * erasure), that's a privileged out-of-band operation, not a normal API.
 */
@Injectable()
export class AuthEventRepository {
  constructor(
    @InjectRepository(AuthEventEntity)
    private readonly repo: Repository<AuthEventEntity>,
  ) {}

  async record(input: {
    eventType: AuthEventType;
    userId?: string | null;
    organizationId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<AuthEventEntity> {
    const entity = this.repo.create({
      eventType: input.eventType,
      userId: input.userId ?? null,
      organizationId: input.organizationId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: input.metadata ?? {},
    });
    return this.repo.save(entity);
  }

  async listByUser(userId: string, limit = 50): Promise<AuthEventEntity[]> {
    return this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async listByOrganization(
    organizationId: TenantId | string,
    limit = 50,
    offset = 0,
  ): Promise<AuthEventEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async countByOrganization(organizationId: TenantId | string): Promise<number> {
    assertTenantId(organizationId);
    return this.repo.count({ where: { organizationId } });
  }

  async listByEventType(eventType: AuthEventType, limit = 50): Promise<AuthEventEntity[]> {
    return this.repo.find({
      where: { eventType },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
