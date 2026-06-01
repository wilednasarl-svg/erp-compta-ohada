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
import { CreateSubsidyDto } from '../dto/create-subsidy.dto';
import { ReleaseSubsidyDto } from '../dto/release-subsidy.dto';
import { ReleaseLinearMonthlyDto, ReleaseOnDepreciationDto } from '../dto/release-auto.dto';
import { SubsidiesService } from '../services/subsidies.service';
import type { SubsidyStatus } from '../types/subsidy.types';

@ApiTags('Subsidies')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/subsidies')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class SubsidiesController {
  constructor(private readonly service: SubsidiesService) {}

  @Get()
  @RequirePermission('subsidies.read')
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('status') status?: SubsidyStatus,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    return this.service.listByOrg(asTenantId(tokenOrgId), { status });
  }

  @Get(':subsidyId')
  @RequirePermission('subsidies.read')
  async detail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('subsidyId', new ParseUUIDPipe({ version: '4' })) subsidyId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    return this.service.findById(asTenantId(tokenOrgId), subsidyId);
  }

  @Post()
  @RequirePermission('subsidies.write')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorId: CurrentUserContext['id'] | undefined,
    @Body() body: CreateSubsidyDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorId);
    return this.service.create(asTenantId(tokenOrgId), body, actorId, buildAuditRequestContext(req));
  }

  @Post(':subsidyId/release-manual')
  @RequirePermission('subsidies.write')
  async releaseManual(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('subsidyId', new ParseUUIDPipe({ version: '4' })) subsidyId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorId: CurrentUserContext['id'] | undefined,
    @Body() body: ReleaseSubsidyDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorId);
    return this.service.releaseManual(
      asTenantId(tokenOrgId),
      subsidyId,
      body,
      actorId,
      buildAuditRequestContext(req),
    );
  }

  @Post(':subsidyId/release-on-depreciation')
  @RequirePermission('subsidies.write')
  async releaseOnDepreciation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('subsidyId', new ParseUUIDPipe({ version: '4' })) subsidyId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorId: CurrentUserContext['id'] | undefined,
    @Body() body: ReleaseOnDepreciationDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorId);
    return this.service.releaseOnDepreciation(
      asTenantId(tokenOrgId),
      subsidyId,
      body.depreciationScheduleId,
      actorId,
      buildAuditRequestContext(req),
    );
  }

  @Post(':subsidyId/release-linear-monthly')
  @RequirePermission('subsidies.write')
  async releaseLinearMonthly(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('subsidyId', new ParseUUIDPipe({ version: '4' })) subsidyId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorId: CurrentUserContext['id'] | undefined,
    @Body() body: ReleaseLinearMonthlyDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorId);
    return this.service.releaseLinearMonthly(
      asTenantId(tokenOrgId),
      subsidyId,
      body.month,
      actorId,
      buildAuditRequestContext(req),
    );
  }

  @Post(':subsidyId/cancel')
  @RequirePermission('subsidies.write')
  async cancel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('subsidyId', new ParseUUIDPipe({ version: '4' })) subsidyId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorId: CurrentUserContext['id'] | undefined,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorId);
    return this.service.cancel(asTenantId(tokenOrgId), subsidyId, actorId);
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
