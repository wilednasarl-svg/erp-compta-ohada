import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
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
import { CreateInvitationDto } from '../dto/create-invitation.dto';
import {
  type CreateInvitationResult,
  InvitationsService,
  type InvitationView,
} from '../services/invitations.service';
import { buildAuditRequestContext } from '../../../common/http/request-context.helper';

/**
 * `InvitationsController` (BE-INV-01, BE-INV-03) — admin surface for the
 * invitation lifecycle. Mounted under `/organizations/:id/invitations`
 * so the URL space matches the spec.
 *
 *   - `POST   /organizations/:id/invitations`
 *     `@RequirePermission('organizations.invite')` — admin and
 *     expert_comptable per the seed matrix. 201 on success.
 *   - `GET    /organizations/:id/invitations`
 *     `@RequirePermission('organizations.read')` — list pending only.
 *   - `DELETE /organizations/:id/invitations/:invitationId`
 *     `@RequirePermission('organizations.invite')` — revoke a pending
 *     invitation. 204; idempotent on already-final rows.
 *
 * The URL `:id` is compared in the route to the `currentOrg.id`
 * (populated by `TenantGuard` from the JWT claim) to fail-closed on
 * accidentally-exposed routes.
 */
@Controller('organizations/:id/invitations')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @RequirePermission('organizations.invite')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @Body() body: CreateInvitationDto,
    @Req() req: Request,
  ): Promise<CreateInvitationResult> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    if (userId === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authenticated user is required',
      });
    }
    return this.invitations.create(
      userId,
      tokenOrgId,
      { email: body.email, roleCode: body.roleCode },
      buildAuditRequestContext(req),
    );
  }

  @Get()
  @RequirePermission('organizations.read')
  async listPending(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<{ invitations: ReadonlyArray<InvitationView> }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const invitations = await this.invitations.listPending(tokenOrgId);
    return { invitations };
  }

  @Delete(':invitationId')
  @RequirePermission('organizations.invite')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('invitationId', new ParseUUIDPipe({ version: '4' })) invitationId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @Req() req: Request,
  ): Promise<void> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    if (userId === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authenticated user is required',
      });
    }
    await this.invitations.revoke(userId, tokenOrgId, invitationId, buildAuditRequestContext(req));
  }

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
