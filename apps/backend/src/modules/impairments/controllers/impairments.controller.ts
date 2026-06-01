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
import { TestAssetImpairmentDto } from '../dto/test-asset-impairment.dto';
import { TestInventoryImpairmentDto } from '../dto/test-inventory-impairment.dto';
import { ImpairmentsService } from '../services/impairments.service';

@ApiTags('Impairments')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/impairments')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ImpairmentsController {
  constructor(private readonly service: ImpairmentsService) {}

  @Get('assets')
  @RequirePermission('impairments.read')
  async listAssets(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('assetId') assetId?: string,
    @Query('limit') limit?: string,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    return this.service.listAssetImpairments(
      asTenantId(tokenOrgId),
      assetId,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('inventory')
  @RequirePermission('impairments.read')
  async listInventory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('inventoryItemId') inventoryItemId?: string,
    @Query('limit') limit?: string,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    return this.service.listInventoryImpairments(
      asTenantId(tokenOrgId),
      inventoryItemId,
      limit ? Number(limit) : undefined,
    );
  }

  @Post('assets/test')
  @RequirePermission('impairments.write')
  @HttpCode(HttpStatus.CREATED)
  async testAsset(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorId: CurrentUserContext['id'] | undefined,
    @Body() body: TestAssetImpairmentDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorId);
    return this.service.testAssetImpairment(
      asTenantId(tokenOrgId),
      body,
      actorId,
      buildAuditRequestContext(req),
    );
  }

  @Post('inventory/test')
  @RequirePermission('impairments.write')
  @HttpCode(HttpStatus.CREATED)
  async testInventory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorId: CurrentUserContext['id'] | undefined,
    @Body() body: TestInventoryImpairmentDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorId);
    return this.service.testInventoryImpairment(
      asTenantId(tokenOrgId),
      body,
      actorId,
      buildAuditRequestContext(req),
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
