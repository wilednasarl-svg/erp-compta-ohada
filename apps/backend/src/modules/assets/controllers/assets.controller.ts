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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
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
import { CreateAssetDto } from '../dto/create-asset.dto';
import { DisposeAssetDto } from '../dto/dispose-asset.dto';
import {
  AssetDisposalResponse,
  AssetEnvelopeResponse,
  AssetWithScheduleResponse,
  ListAssetsResponse,
  ListSchedulesResponse,
  ScheduleEnvelopeResponse,
} from '../dto/responses';
import { UpdateAssetDto } from '../dto/update-asset.dto';
import {
  toAssetDisposal,
  toAssetEnvelope,
  toAssetWithSchedule,
  toListAssets,
  toListSchedules,
  toScheduleEnvelope,
} from '../mappers/asset-response.mapper';
import { AssetsService } from '../services/assets.service';

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
  @ApiOkResponse({ type: ListAssetsResponse })
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<ListAssetsResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const assets = await this.assets.listForOrg(asTenantId(tokenOrgId));
    return toListAssets(assets);
  }

  // ─── Get one asset ──────────────────────────────────────────────────

  @Get(':assetId')
  @RequirePermission('assets.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AssetEnvelopeResponse })
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<AssetEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const asset = await this.assets.findById(assetId, asTenantId(tokenOrgId));
    return toAssetEnvelope(asset);
  }

  // ─── Get depreciation schedule ──────────────────────────────────────

  @Get(':assetId/schedule')
  @RequirePermission('assets.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListSchedulesResponse })
  async getSchedule(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<ListSchedulesResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const schedule = await this.assets.getSchedule(assetId, asTenantId(tokenOrgId));
    return toListSchedules(schedule);
  }

  // ─── Create ─────────────────────────────────────────────────────────

  @Post()
  @RequirePermission('assets.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: AssetWithScheduleResponse })
  async create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: CreateAssetDto,
    @Req() req: Request,
  ): Promise<AssetWithScheduleResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.assets.create(
      asTenantId(tokenOrgId),
      body,
      actorUserId,
      buildAuditRequestContext(req),
    );
    return toAssetWithSchedule(result.asset, result.schedule);
  }

  // ─── Update ─────────────────────────────────────────────────────────

  @Patch(':assetId')
  @RequirePermission('assets.write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AssetWithScheduleResponse })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: UpdateAssetDto,
    @Req() req: Request,
  ): Promise<AssetWithScheduleResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.assets.update(
      assetId,
      asTenantId(tokenOrgId),
      body,
      actorUserId,
      buildAuditRequestContext(req),
    );
    return toAssetWithSchedule(result.asset, result.schedule);
  }

  // ─── Dispose ────────────────────────────────────────────────────────

  @Post(':assetId/dispose')
  @RequirePermission('assets.write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AssetDisposalResponse })
  async dispose(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: DisposeAssetDto,
    @Req() req: Request,
  ): Promise<AssetDisposalResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.assets.dispose(
      assetId,
      asTenantId(tokenOrgId),
      body,
      actorUserId,
      buildAuditRequestContext(req),
    );
    return toAssetDisposal(result.asset, result.journalEntries);
  }

  // ─── Post depreciation ─────────────────────────────────────────────

  @Post('schedules/:scheduleId/post')
  @RequirePermission('assets.post_depreciation')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ScheduleEnvelopeResponse })
  async postDepreciation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('scheduleId', new ParseUUIDPipe({ version: '4' })) scheduleId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Req() req: Request,
  ): Promise<ScheduleEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const schedule = await this.assets.postDepreciation(
      scheduleId,
      asTenantId(tokenOrgId),
      actorUserId,
      buildAuditRequestContext(req),
    );
    return toScheduleEnvelope(schedule);
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
