import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditLogEntity } from '../entities/audit-log.entity';

/**
 * Filter shape consumed by `AuditLogRepository.list` / `count`.
 *
 * All filter fields are optional EXCEPT `organizationId` on the
 * tenant-scoped path: callers MUST pass it so the controller can
 * never accidentally leak rows across tenants. The "system" reader
 * (no tenant scope) is not exposed at the HTTP layer in vague 1 —
 * platform admins read directly from the DB.
 */
export interface AuditCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface AuditLogListFilters {
  readonly organizationId: TenantId | string;
  readonly module?: string;
  readonly action?: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly userId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit?: number;
  readonly offset?: number;
  readonly cursor?: string;
}

/**
 * Encode a keyset cursor from the last row of a page.
 * Returns a base64url string safe for URL query params.
 */
export function encodeCursor(row: { createdAt: Date; id: string }): string {
  const payload: AuditCursor = { createdAt: row.createdAt.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode a cursor string. Returns `null` on any invalid input so
 * a garbage cursor degrades to a first-page query rather than a 500.
 */
export function decodeCursor(cursor: string): AuditCursor | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'createdAt' in parsed &&
      'id' in parsed &&
      typeof (parsed as AuditCursor).createdAt === 'string' &&
      typeof (parsed as AuditCursor).id === 'string'
    ) {
      return parsed as AuditCursor;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Input accepted by `record`. All fields are normalized to NULL when
 * absent so the row shape on disk is deterministic regardless of how
 * lightly the caller filled the value object.
 */
export interface AuditLogWriteInput {
  readonly module: string;
  readonly action: string;
  readonly userId?: string | null;
  readonly organizationId?: string | null;
  readonly entityType?: string | null;
  readonly entityId?: string | null;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string | null;
  readonly metadata?: Record<string, unknown>;
  /**
   * Override for `event_type` (the legacy compound code). When omitted
   * we synthesize it as `${module}.${action}` so the legacy
   * `AuthEventsController` projection keeps working unchanged.
   */
  readonly legacyEventType?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * `AuditLogRepository` (BE-AUDIT-11) — single sanctioned writer + reader
 * for the unified Module 7 audit journal.
 *
 * Mutation / deletion is intentionally NOT exposed: the journal is
 * append-only by spec (`specs/auth/spec.md`, extended by
 * `docs/produit/module-7-audit-trail.md`). If a row needs to disappear
 * (GDPR erasure) that's a privileged out-of-band operation, not a
 * normal repository API.
 *
 * The `list` reader builds its query through `createQueryBuilder` so
 * a `null` filter cell on `entityType`/`entityId` cannot accidentally
 * be replaced with the SQL string `'null'` (a TypeORM `find` foot-gun).
 * Tenant scope is asserted via `assertTenantId` to make a missing
 * `organizationId` a 500 with a clear stack rather than a silent
 * cross-tenant leak.
 */
@Injectable()
export class AuditLogRepository {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repo: Repository<AuditLogEntity>,
  ) {}

  async record(input: AuditLogWriteInput): Promise<AuditLogEntity> {
    const eventType =
      input.legacyEventType !== undefined
        ? input.legacyEventType
        : `${input.module}.${input.action}`;

    const entity = this.repo.create({
      eventType,
      module: input.module,
      action: input.action,
      userId: input.userId ?? null,
      organizationId: input.organizationId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? null,
      metadata: input.metadata ?? {},
    });
    return this.repo.save(entity);
  }

  async list(filters: AuditLogListFilters): Promise<AuditLogEntity[]> {
    assertTenantId(filters.organizationId);
    const qb = this.buildScopedQuery(filters);
    qb.orderBy('log.created_at', 'DESC').addOrderBy('log.id', 'DESC');

    const parsed = filters.cursor ? decodeCursor(filters.cursor) : null;
    if (parsed !== null) {
      // Keyset: rows strictly before (created_at, id) using DESC order.
      qb.andWhere(`(log.created_at, log.id) < (:cursorAt::timestamptz, :cursorId::uuid)`, {
        cursorAt: parsed.createdAt,
        cursorId: parsed.id,
      });
    } else {
      qb.skip(filters.offset ?? 0);
    }

    qb.take(this.boundedLimit(filters.limit));
    return qb.getMany();
  }

  async count(filters: AuditLogListFilters): Promise<number> {
    assertTenantId(filters.organizationId);
    return this.buildScopedQuery(filters).getCount();
  }

  private buildScopedQuery(filters: AuditLogListFilters) {
    const qb = this.repo
      .createQueryBuilder('log')
      .where('log.organization_id = :orgId', { orgId: filters.organizationId });

    if (filters.module !== undefined) {
      qb.andWhere('log.module = :module', { module: filters.module });
    }
    if (filters.action !== undefined) {
      qb.andWhere('log.action = :action', { action: filters.action });
    }
    if (filters.entityType !== undefined) {
      qb.andWhere('log.entity_type = :entityType', { entityType: filters.entityType });
    }
    if (filters.entityId !== undefined) {
      qb.andWhere('log.entity_id = :entityId', { entityId: filters.entityId });
    }
    if (filters.userId !== undefined) {
      qb.andWhere('log.user_id = :userId', { userId: filters.userId });
    }
    if (filters.from !== undefined || filters.to !== undefined) {
      qb.andWhere(
        new Brackets((b) => {
          if (filters.from !== undefined) {
            b.andWhere('log.created_at >= :from', { from: filters.from });
          }
          if (filters.to !== undefined) {
            b.andWhere('log.created_at <= :to', { to: filters.to });
          }
        }),
      );
    }
    return qb;
  }

  private boundedLimit(limit: number | undefined): number {
    if (limit === undefined) {
      return DEFAULT_LIMIT;
    }
    if (limit < 1) {
      return 1;
    }
    if (limit > MAX_LIMIT) {
      return MAX_LIMIT;
    }
    return limit;
  }
}
