import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { buildAuditRequestContext } from '../../../common/http/request-context.helper';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext, CurrentUserContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { CreateProvisionDto } from '../dto/create-provision.dto';
import { ProvisionMovementDto } from '../dto/provision-movement.dto';
import { ProvisionsService } from '../services/provisions.service';
import type { ProvisionStatus, ProvisionType } from '../types/provision.types';

@ApiTags('Provisions')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/provisions')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ProvisionsController {
  constructor(private readonly service: ProvisionsService) {}

  @Get()
  @RequirePermission('provisions.read')
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('status') status?: ProvisionStatus,
    @Query('type') type?: ProvisionType,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    return this.service.listByOrg(asTenantId(tokenOrgId), {
      status,
      type,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get(':provisionId')
  @RequirePermission('provisions.read')
  async detail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('provisionId', new ParseUUIDPipe({ version: '4' })) provisionId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    return this.service.findById(asTenantId(tokenOrgId), provisionId);
  }

  @Post()
  @RequirePermission('provisions.write')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorId: CurrentUserContext['id'] | undefined,
    @Body() body: CreateProvisionDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorId);
    return this.service.create(asTenantId(tokenOrgId), body, actorId, buildAuditRequestContext(req));
  }

  @Post(':provisionId/dotation')
  @RequirePermission('provisions.write')
  async dotation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('provisionId', new ParseUUIDPipe({ version: '4' })) provisionId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorId: CurrentUserContext['id'] | undefined,
    @Body() body: ProvisionMovementDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorId);
    return this.service.dotation(
      asTenantId(tokenOrgId),
      provisionId,
      body.amount,
      body.effectiveDate,
      actorId,
      buildAuditRequestContext(req),
      body.note,
    );
  }

  @Post(':provisionId/reprise')
  @RequirePermission('provisions.write')
  async reprise(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('provisionId', new ParseUUIDPipe({ version: '4' })) provisionId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorId: CurrentUserContext['id'] | undefined,
    @Body() body: ProvisionMovementDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorId);
    return this.service.reprise(
      asTenantId(tokenOrgId),
      provisionId,
      body.amount,
      body.effectiveDate,
      actorId,
      buildAuditRequestContext(req),
      body.note,
    );
  }

  @Post(':provisionId/utilization')
  @RequirePermission('provisions.write')
  async utilization(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('provisionId', new ParseUUIDPipe({ version: '4' })) provisionId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorId: CurrentUserContext['id'] | undefined,
    @Body() body: ProvisionMovementDto,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorId);
    return this.service.utilization(
      asTenantId(tokenOrgId),
      provisionId,
      body.amount,
      body.effectiveDate,
      actorId,
      body.note,
    );
  }

  private assertOrgMatch(
    pathOrgId: string,
    tokenOrgId: string | undefined,
  ): asserts tokenOrgId is string {
    if (tokenOrgId === undefined || pathOrgId !== tokenOrgId) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, { message: 'Organization not found' });
    }
  }

  private assertActor(actorId: string | undefined): asserts actorId is string {
    if (actorId === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, { message: 'Missing actor identity' });
    }
  }
}
