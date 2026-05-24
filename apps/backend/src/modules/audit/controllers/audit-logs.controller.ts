import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { CurrentOrgContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { ListAuditLogsQueryDto } from '../dto/list-audit-logs-query.dto';
import type { AuditLogEntity } from '../entities/audit-log.entity';
import { AuditLogRepository } from '../repositories/audit-log.repository';

/**
 * Stable wire shape for an audit log row. Decoupled from
 * `AuditLogEntity` so a future ORM rename / column reshape doesn't
 * break the public API. Matches the JSON contract described in
 * `docs/produit/module-7-audit-trail.md`.
 */
interface AuditLogView {
  readonly id: string;
  readonly module: string;
  readonly action: string;
  readonly eventType: string;
  readonly userId: string | null;
  readonly organizationId: string | null;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly metadata: Record<string, unknown>;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly createdAt: string;
}

function toView(row: AuditLogEntity): AuditLogView {
  return {
    id: row.id,
    module: row.module,
    action: row.action,
    eventType: row.eventType,
    userId: row.userId,
    organizationId: row.organizationId,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.before,
    after: row.after,
    metadata: row.metadata,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * `AuditLogsController` (BE-AUDIT-20) — generic, tenant-scoped reader
 * over the unified Module 7 audit journal.
 *
 * Mounted at `/audit/logs` (not under `/organizations/:id/...`) because
 * the journal is cross-module and the tenant scope is already bound by
 * `TenantGuard` from the JWT — no path param needed. The legacy
 * `GET /organizations/:id/auth-events` (Module 1) keeps working
 * alongside this controller for back-compat; new consumers should
 * prefer `/audit/logs` because it exposes `module` / `action` / entity
 * filters.
 *
 * Authorization
 * -------------
 * Same `audit.read` permission as the legacy auth_events viewer (seeded
 * by migration 0005 against `admin` and `expert_comptable`). Reusing
 * the permission code keeps the role matrix simple: a tenant admin who
 * could already view auth events automatically gains access to the
 * unified journal without a new permissions migration.
 *
 * Tenant scope
 * ------------
 * `TenantGuard` binds `currentOrg` from the JWT `org_id` claim, after
 * cross-checking an active membership row. The query is then scoped
 * via `AuditLogRepository.list({ organizationId: tokenOrgId, … })` —
 * a missing or whitespace `organizationId` triggers
 * `assertTenantId(...)` and surfaces as a 500 with a clear stack
 * rather than a silent cross-tenant leak.
 *
 * Pagination
 * ----------
 * Offset-based, bounded by `MAX_LIMIT` (200) in the DTO. Same shape as
 * the rest of the API (`/auth-events`, `/chart-of-accounts`) so the
 * frontend list components are reusable. A cursor variant lands in
 * vague 2 if the journal grows past comfortable offset scans.
 */
@ApiTags('Audit')
@ApiBearerAuth('bearer')
@Controller('audit/logs')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class AuditLogsController {
  constructor(private readonly logs: AuditLogRepository) {}

  @Get()
  @RequirePermission('audit.read')
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<{
    logs: ReadonlyArray<AuditLogView>;
    pagination: { limit: number; offset: number; total: number };
  }> {
    // Defensive: `TenantGuard` should always bind `currentOrg`, but
    // surfacing a clear 401 here saves a confusing tenant-scope error
    // from the repository if the guard is misconfigured upstream.
    if (tokenOrgId === undefined) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Organization context required',
      });
    }

    // `from > to` is a user mistake — empty result instead of an
    // error keeps the endpoint idempotent for dashboard polling and
    // avoids leaking timezone foot-guns. The frontend should still
    // validate before submitting.
    if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      return {
        logs: [],
        pagination: { limit: query.limit, offset: query.offset, total: 0 },
      };
    }

    const filters = {
      organizationId: tokenOrgId,
      module: query.module,
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      userId: query.userId,
      from: query.from,
      to: query.to,
      limit: query.limit,
      offset: query.offset,
    };

    const [rows, total] = await Promise.all([
      this.logs.list(filters),
      this.logs.count({
        organizationId: filters.organizationId,
        module: filters.module,
        action: filters.action,
        entityType: filters.entityType,
        entityId: filters.entityId,
        userId: filters.userId,
        from: filters.from,
        to: filters.to,
      }),
    ]);

    return {
      logs: rows.map(toView),
      pagination: { limit: query.limit, offset: query.offset, total },
    };
  }
}
