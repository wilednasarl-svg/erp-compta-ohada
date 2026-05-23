import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { CurrentOrgContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { ListAuthEventsQueryDto } from '../../audit/dto/list-auth-events-query.dto';
import type { AuthEventEntity } from '../../audit/entities/auth-event.entity';
import { AuthEventRepository } from '../../audit/repositories/auth-event.repository';

/**
 * Wire shape returned by `GET /organizations/:id/auth-events`. Kept
 * separate from `AuthEventEntity` so the public contract is stable
 * even if the ORM mapping evolves (e.g. column rename, relation
 * eager-load).
 */
interface AuthEventView {
  readonly id: string;
  readonly eventType: string;
  readonly userId: string | null;
  readonly organizationId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

function toView(row: AuthEventEntity): AuthEventView {
  return {
    id: row.id,
    eventType: row.eventType,
    userId: row.userId,
    organizationId: row.organizationId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * `AuthEventsController` (BE-AUDIT-02) — admin-only paginated read of the
 * append-only `auth_events` journal scoped to the current org.
 *
 * Mounted at `/organizations/:id/auth-events` to keep all tenant-scoped
 * endpoints under the same URL space. The class-level guard chain
 * (`JwtAuthGuard` → `TenantGuard` → `PermissionsGuard`) ensures the
 * caller is authenticated, has an active membership in the requested
 * org, and holds the `audit.read` permission (seeded against the
 * `admin` and `expert_comptable` roles by migration 0005).
 *
 * No write surface exposed — the journal is append-only by spec. The
 * repository itself does not implement `update`/`delete` for auth
 * events, so even a misconfigured controller cannot accidentally
 * mutate the row.
 */
@Controller('organizations/:id/auth-events')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class AuthEventsController {
  constructor(private readonly events: AuthEventRepository) {}

  @Get()
  @RequirePermission('audit.read')
  @HttpCode(HttpStatus.OK)
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query() query: ListAuthEventsQueryDto,
  ): Promise<{
    events: ReadonlyArray<AuthEventView>;
    pagination: { limit: number; offset: number; total: number };
  }> {
    if (tokenOrgId === undefined || tokenOrgId !== pathOrgId) {
      // Defensive — TenantGuard already binds currentOrg from the JWT
      // claim. Path-vs-token mismatch returns 404 (not 403) per the
      // "no info disclosure" policy.
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Organization not found',
      });
    }

    const [rows, total] = await Promise.all([
      this.events.listByOrganization(tokenOrgId, query.limit, query.offset),
      this.events.countByOrganization(tokenOrgId),
    ]);

    return {
      events: rows.map(toView),
      pagination: { limit: query.limit, offset: query.offset, total },
    };
  }
}
