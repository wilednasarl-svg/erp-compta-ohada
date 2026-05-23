import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { CurrentOrgContext, CurrentUserContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { MembershipsService, type MemberView } from '../../rbac/services/memberships.service';
import { ChangeMemberRoleDto } from '../dto/change-member-role.dto';
import { buildAuditRequestContext } from '../../../common/http/request-context.helper';

/**
 * `MembersController` (BE-ORG-07..08) — tenant-scoped member surface,
 * mounted under `/organizations/:id/members` to match the spec URL space.
 *
 *   - `GET    /organizations/:id/members`           — read view, gated by
 *     `@RequirePermission('organizations.read')`.
 *   - `PATCH  /organizations/:id/members/:userId`   — role change, gated
 *     by `@RequirePermission('organizations.manage_members')`. Enforces
 *     the "at least one active admin" invariant (spec 7.7).
 *
 * Every route uses the JWT-claim org as the authoritative tenant
 * (`@CurrentOrg('id')`); the path-level `:id` is compared in the route
 * to fail-closed on a route bypassed by an upstream guard misconfig.
 */
@ApiTags('Members')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/members')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class MembersController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  @RequirePermission('organizations.read')
  @HttpCode(HttpStatus.OK)
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<{ members: ReadonlyArray<MemberView> }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const members = await this.memberships.listMembers(tokenOrgId);
    return { members };
  }

  @Patch(':userId')
  @RequirePermission('organizations.manage_members')
  @HttpCode(HttpStatus.OK)
  async changeRole(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) targetUserId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: ChangeMemberRoleDto,
    @Req() req: Request,
  ): Promise<{ member: MemberView }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    if (actorUserId === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authenticated user is required',
      });
    }
    const member = await this.memberships.changeRole(
      actorUserId,
      tokenOrgId,
      targetUserId,
      body.roleCode,
      buildAuditRequestContext(req),
    );
    return { member };
  }

  /**
   * `DELETE /organizations/:id/members/:userId` (BE-ORG-07) — admin-only
   * member removal. 204 No Content on success.
   *
   * Same `@RequirePermission('organizations.manage_members')` as
   * `changeRole`. Enforces the ORG_LAST_ADMIN invariant in the service
   * layer — refuses to remove the only active admin.
   */
  @Delete(':userId')
  @RequirePermission('organizations.manage_members')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) targetUserId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Req() req: Request,
  ): Promise<void> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    if (actorUserId === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authenticated user is required',
      });
    }
    await this.memberships.removeMember(
      actorUserId,
      tokenOrgId,
      targetUserId,
      buildAuditRequestContext(req),
    );
  }

  /**
   * Defensive URL-vs-token match. TenantGuard already binds the
   * authoritative tenant on `currentOrg`; this is the second line of
   * defence for routes accidentally exposed without the guard. Returns
   * 404 (never 403) to keep with the spec's "no info disclosure" policy.
   */
  private assertOrgMatch(
    pathOrgId: string,
    tokenOrgId: string | undefined,
  ): asserts tokenOrgId is string {
    if (tokenOrgId === undefined || pathOrgId !== tokenOrgId) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Organization not found',
      });
    }
  }
}
