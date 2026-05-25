import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { AssetsService } from '../services/assets.service';
import { CreateAssetDto } from '../dto/create-asset.dto';
import { UpdateAssetDto } from '../dto/update-asset.dto';
import { DisposeAssetDto } from '../dto/dispose-asset.dto';

@ApiTags('Assets')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/assets')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  // ─── List all assets ────────────────────────────────────────────────

  @Get()
  @RequirePermission('assets.read')
  @HttpCode(HttpStatus.OK)
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const assets = await this.assets.listForOrg(asTenantId(tokenOrgId));
    return { assets };
  }

  // ─── Get one asset ──────────────────────────────────────────────────

  @Get(':assetId')
  @RequirePermission('assets.read')
  @HttpCode(HttpStatus.OK)
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const asset = await this.assets.findById(assetId, asTenantId(tokenOrgId));
    return { asset };
  }

  // ─── Get depreciation schedule ──────────────────────────────────────

  @Get(':assetId/schedule')
  @RequirePermission('assets.read')
  @HttpCode(HttpStatus.OK)
  async getSchedule(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const schedule = await this.assets.getSchedule(assetId, asTenantId(tokenOrgId));
    return { schedule };
  }

  // ─── Create ─────────────────────────────────────────────────────────

  @Post()
  @RequirePermission('assets.write')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: CreateAssetDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.assets.create(
      asTenantId(tokenOrgId),
      body,
      actorUserId,
      buildAuditRequestContext(req),
    );
    return result;
  }

  // ─── Update ─────────────────────────────────────────────────────────

  @Patch(':assetId')
  @RequirePermission('assets.write')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: UpdateAssetDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.assets.update(
      assetId,
      asTenantId(tokenOrgId),
      body,
      actorUserId,
      buildAuditRequestContext(req),
    );
    return result;
  }

  // ─── Dispose ────────────────────────────────────────────────────────

  @Post(':assetId/dispose')
  @RequirePermission('assets.write')
  @HttpCode(HttpStatus.OK)
  async dispose(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: DisposeAssetDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const asset = await this.assets.dispose(
      assetId,
      asTenantId(tokenOrgId),
      body.disposalDate,
      body.disposalValue ?? null,
      actorUserId,
      buildAuditRequestContext(req),
    );
    return { asset };
  }

  // ─── Post depreciation ─────────────────────────────────────────────

  @Post('schedules/:scheduleId/post')
  @RequirePermission('assets.post_depreciation')
  @HttpCode(HttpStatus.OK)
  async postDepreciation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('scheduleId', new ParseUUIDPipe({ version: '4' })) scheduleId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const schedule = await this.assets.postDepreciation(
      scheduleId,
      asTenantId(tokenOrgId),
      actorUserId,
      buildAuditRequestContext(req),
    );
    return { schedule };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

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

  private assertActor(actorUserId: string | undefined): asserts actorUserId is string {
    if (actorUserId === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authenticated user is required',
      });
    }
  }
}
