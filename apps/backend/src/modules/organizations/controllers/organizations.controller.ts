import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Roles } from '../../rbac/decorators/roles.decorator';
import { RolesGuard } from '../../rbac/guards/roles.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import type { CurrentOrgContext, CurrentUserContext } from '../../../common/types/request-context';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';
import type {
  CreateOrganizationResult,
  OrganizationSummary,
} from '../services/organizations.service';
import { OrganizationsService } from '../services/organizations.service';
import type { OrganizationEntity } from '../entities/organization.entity';

function extractAuditContext(req: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const ip = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : null;
  const uaHeader = req.headers['user-agent'];
  const userAgent = typeof uaHeader === 'string' && uaHeader.length > 0 ? uaHeader : null;
  return { ipAddress: ip, userAgent };
}

/**
 * `OrganizationsController` (BE-ORG-01..03) — MVP organization surface.
 *
 *   - `POST   /organizations`      — JwtAuthGuard only. Any authenticated
 *                                    user can create an org; the creator
 *                                    is auto-assigned the `admin`
 *                                    membership. No tenant context needed
 *                                    (the new org IS the tenant).
 *   - `GET    /organizations`      — JwtAuthGuard only. Lists every
 *                                    organization where the caller has an
 *                                    active membership.
 *   - `PATCH  /organizations/:id`  — JwtAuthGuard + TenantGuard +
 *                                    RolesGuard('admin'). Rename only;
 *                                    slug is immutable.
 *
 * The PATCH route relies entirely on `currentOrg.id` (populated by
 * `TenantGuard` from the JWT `org_id` claim) to identify the target.
 * The URL `:id` is compared in the service for spec-compliant "no info
 * disclosure" on cross-tenant attempts.
 */
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateOrganizationDto,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @Req() req: Request,
  ): Promise<CreateOrganizationResult> {
    // JwtAuthGuard always binds `currentUser`; the undefined branch only
    // fires if the route is mis-composed.
    if (userId === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authenticated user is required',
      });
    }
    return this.orgs.create(userId, { name: body.name, type: body.type }, extractAuditContext(req));
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
  ): Promise<{ organizations: ReadonlyArray<OrganizationSummary> }> {
    if (userId === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authenticated user is required',
      });
    }
    const organizations = await this.orgs.listForUser(userId);
    return { organizations };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles('admin')
  async update(
    @Param('id') targetOrgId: string,
    @Body() body: UpdateOrganizationDto,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @CurrentOrg('id') currentOrgId: CurrentOrgContext['id'] | undefined,
    @Req() req: Request,
  ): Promise<{ organization: OrganizationEntity }> {
    if (userId === undefined || currentOrgId === undefined) {
      // Defensive — TenantGuard upstream guarantees both. If we land
      // here, the route composition is broken; fail closed.
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Organization not found',
      });
    }
    return this.orgs.update(
      userId,
      targetOrgId,
      currentOrgId,
      { ...(body.name !== undefined ? { name: body.name } : {}) },
      extractAuditContext(req),
    );
  }
}
