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
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
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
import {
  CreateOrganizationResponse,
  ListOrganizationsResponse,
  OrganizationEnvelopeResponse,
} from '../dto/responses';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';
import {
  toCreateOrganization,
  toListOrganizations,
  toOrganizationEnvelope,
} from '../mappers/organization-response.mapper';
import { OrganizationsService } from '../services/organizations.service';
import { buildAuditRequestContext } from '../../../common/http/request-context.helper';

@ApiTags('Organizations')
@ApiBearerAuth('bearer')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: CreateOrganizationResponse })
  async create(
    @Body() body: CreateOrganizationDto,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @Req() req: Request,
  ): Promise<CreateOrganizationResponse> {
    if (userId === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authenticated user is required',
      });
    }
    const result = await this.orgs.create(
      userId,
      { name: body.name, type: body.type, system: body.system },
      buildAuditRequestContext(req),
    );
    return toCreateOrganization(result);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: ListOrganizationsResponse })
  async list(
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
  ): Promise<ListOrganizationsResponse> {
    if (userId === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authenticated user is required',
      });
    }
    const summaries = await this.orgs.listForUser(userId);
    return toListOrganizations(summaries);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles('admin')
  @ApiOkResponse({ type: OrganizationEnvelopeResponse })
  async update(
    @Param('id') targetOrgId: string,
    @Body() body: UpdateOrganizationDto,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @CurrentOrg('id') currentOrgId: CurrentOrgContext['id'] | undefined,
    @Req() req: Request,
  ): Promise<OrganizationEnvelopeResponse> {
    if (userId === undefined || currentOrgId === undefined) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Organization not found',
      });
    }
    const result = await this.orgs.update(
      userId,
      targetOrgId,
      currentOrgId,
      { ...(body.name !== undefined ? { name: body.name } : {}) },
      buildAuditRequestContext(req),
    );
    return toOrganizationEnvelope(result.organization);
  }
}
