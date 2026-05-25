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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext, CurrentUserContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { CreateInventoryItemDto } from '../dto/create-item.dto';
import { UpdateInventoryItemDto } from '../dto/update-item.dto';
import { InventoryItemsService } from '../services/inventory-items.service';
import type { StockFamily } from '../types/inventory.types';

@ApiTags('Inventory — Items')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/inventory/items')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class InventoryItemsController {
  constructor(private readonly items: InventoryItemsService) {}

  @Get()
  @RequirePermission('inventory.read')
  @HttpCode(HttpStatus.OK)
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('activeOnly') activeOnly?: string,
    @Query('family') family?: StockFamily,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const list = await this.items.listForOrg(asTenantId(tokenOrgId), {
      activeOnly: activeOnly === 'true',
      family,
    });
    return { items: list };
  }

  @Get(':itemId')
  @RequirePermission('inventory.read')
  @HttpCode(HttpStatus.OK)
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const item = await this.items.findById(itemId, asTenantId(tokenOrgId));
    return { item };
  }

  @Post()
  @RequirePermission('inventory.write')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: CreateInventoryItemDto,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const item = await this.items.create(asTenantId(tokenOrgId), body, actorUserId);
    return { item };
  }

  @Patch(':itemId')
  @RequirePermission('inventory.write')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Body() body: UpdateInventoryItemDto,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const item = await this.items.update(itemId, asTenantId(tokenOrgId), body);
    return { item };
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

  private assertActor(actorUserId: string | undefined): asserts actorUserId is string {
    if (actorUserId === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authenticated user is required',
      });
    }
  }
}
