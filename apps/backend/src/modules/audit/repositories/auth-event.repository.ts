import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuthEventEntity, type AuthEventType } from '../entities/auth-event.entity';

/**
 * `AuthEventRepository` — tenant-scoped READ-ONLY accessor for the legacy
 * `auth_events` projection (the `AuthEventsController` under
 * `/organizations/:id/auth-events`).
 *
 * Writes are NOT supported on this repository. Module 7 (audit trail
 * engine, migration 0019) added `module` / `action` NOT NULL columns to
 * the shared `auth_events` table. Inserting through this entity would
 * leave those columns NULL and violate the constraint at runtime. The
 * only sanctioned write path is `AuditTrailService.record` (used
 * directly by Module 7+ callers, and indirectly via `AuthEventsService
 * .record` for the legacy Module 1 codes — which derives `module` /
 * `action` from `eventType` before delegating).
 *
 * `organization_id` is nullable on this table (a failed login by an
 * unknown email has no org), so the global "all events for user U"
 * read accepts a missing scope. The tenant-scoped read
 * (`listByOrganization`) explicitly requires `organizationId` — used
 * by admin audit views.
 *
 * Mutation / deletion is intentionally NOT supported. `specs/auth/spec.md`
 * mandates an immutable journal; if a row needs to disappear (GDPR
 * erasure), that's a privileged out-of-band operation, not a normal API.
 */
@Injectable()
export class AuthEventRepository {
  constructor(
    @InjectRepository(AuthEventEntity)
    private readonly repo: Repository<AuthEventEntity>,
  ) {}

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
