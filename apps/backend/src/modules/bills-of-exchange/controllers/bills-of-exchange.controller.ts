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
import { CreateBillDto } from '../dto/create-bill.dto';
import { DiscountBillDto } from '../dto/discount-bill.dto';
import { SettleBillDto } from '../dto/settle-bill.dto';
import { BillsOfExchangeService } from '../services/bills-of-exchange.service';
import type { BillKind, BillStatus } from '../types/bill.types';

@ApiTags('BillsOfExchange')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/bills-of-exchange')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BillsOfExchangeController {
  constructor(private readonly service: BillsOfExchangeService) {}

  @Get()
  @RequirePermission('bills_of_exchange.read')
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('kind') kind?: BillKind,
    @Query('status') status?: BillStatus,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    return this.service.listByOrg(asTenantId(tokenOrgId), { kind, status });
  }

  @Get(':billId')
  @RequirePermission('bills_of_exchange.read')
  async detail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('billId', new ParseUUIDPipe({ version: '4' })) billId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    return this.service.findById(asTenantId(tokenOrgId), billId);
  }

  @Post()
  @RequirePermission('bills_of_exchange.write')
  @HttpCode(HttpStatus.CREATED)
  async issue(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorId: CurrentUserContext['id'] | undefined,
    @Body() body: CreateBillDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorId);
    return this.service.issue(asTenantId(tokenOrgId), body, actorId, buildAuditRequestContext(req));
  }

  @Post(':billId/discount')
  @RequirePermission('bills_of_exchange.write')
  async discount(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('billId', new ParseUUIDPipe({ version: '4' })) billId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorId: CurrentUserContext['id'] | undefined,
    @Body() body: DiscountBillDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorId);
    return this.service.discount(
      asTenantId(tokenOrgId),
      billId,
      body,
      actorId,
      buildAuditRequestContext(req),
    );
  }

  @Post(':billId/settle')
  @RequirePermission('bills_of_exchange.write')
  async settle(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('billId', new ParseUUIDPipe({ version: '4' })) billId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorId: CurrentUserContext['id'] | undefined,
    @Body() body: SettleBillDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorId);
    return this.service.settle(
      asTenantId(tokenOrgId),
      billId,
      body,
      actorId,
      buildAuditRequestContext(req),
    );
  }

  @Post(':billId/mark-unpaid')
  @RequirePermission('bills_of_exchange.write')
  async markUnpaid(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('billId', new ParseUUIDPipe({ version: '4' })) billId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorId: CurrentUserContext['id'] | undefined,
    @Body() body: SettleBillDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorId);
    return this.service.markUnpaid(
      asTenantId(tokenOrgId),
      billId,
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
