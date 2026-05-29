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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

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
import { ListMovementsQueryDto } from '../dto/list-movements-query.dto';
import { RecordMovementDto } from '../dto/record-movement.dto';
import { ListInventoryMovementsResponse, RecordMovementResponse } from '../dto/responses';
import { toListInventoryMovements, toRecordMovement } from '../mappers/inventory-response.mapper';
import { InventoryMovementsService } from '../services/inventory-movements.service';

@ApiTags('Inventory — Movements')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/inventory')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class InventoryMovementsController {
  constructor(private readonly movements: InventoryMovementsService) {}

  @Get('movements')
  @RequirePermission('inventory.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List inventory movements' })
  @ApiOkResponse({ type: ListInventoryMovementsResponse })
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query() query: ListMovementsQueryDto,
  ): Promise<ListInventoryMovementsResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const list = await this.movements.list(asTenantId(tokenOrgId), query);
    return toListInventoryMovements(list);
  }

  @Post('items/:itemId/movements')
  @RequirePermission('inventory.move')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record an inventory movement' })
  @ApiCreatedResponse({ type: RecordMovementResponse })
  async record(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: RecordMovementDto,
  ): Promise<RecordMovementResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.movements.recordMovement(
      asTenantId(tokenOrgId),
      itemId,
      {
        type: body.type,
        movementDate: body.movementDate,
        qty: body.qty,
        unitPrice: body.unitPrice ?? null,
        reference: body.reference ?? null,
        description: body.description ?? null,
      },
      actorUserId,
    );
    return toRecordMovement(result);
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
