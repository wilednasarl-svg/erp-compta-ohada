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
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { CreateBudgetAxisDto } from '../dto/create-budget-axis.dto';
import { UpdateBudgetAxisDto } from '../dto/update-budget-axis.dto';
import { BudgetAxisEnvelopeResponse, ListBudgetAxesResponse } from '../dto/responses';
import { toBudgetAxisEnvelope, toListBudgetAxes } from '../mappers/budget-response.mapper';
import { BudgetAxesService } from '../services/budget-axes.service';
import type { BudgetAxisType } from '../types/budget.types';

@ApiTags('Budget — Axes analytiques')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/budget/axes')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BudgetAxesController {
  constructor(private readonly axes: BudgetAxesService) {}

  @Get()
  @RequirePermission('budget.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListBudgetAxesResponse })
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('axisType') axisType?: BudgetAxisType,
    @Query('activeOnly') activeOnly?: string,
  ): Promise<ListBudgetAxesResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const axes = await this.axes.list(asTenantId(tokenOrgId), {
      axisType,
      activeOnly: activeOnly === 'true',
    });
    return toListBudgetAxes(axes);
  }

  @Get(':axisId')
  @RequirePermission('budget.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BudgetAxisEnvelopeResponse })
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('axisId', new ParseUUIDPipe({ version: '4' })) axisId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<BudgetAxisEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const axis = await this.axes.findById(axisId, asTenantId(tokenOrgId));
    return toBudgetAxisEnvelope(axis);
  }

  @Post()
  @RequirePermission('budget.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: BudgetAxisEnvelopeResponse })
  async create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Body() dto: CreateBudgetAxisDto,
  ): Promise<BudgetAxisEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const axis = await this.axes.create(asTenantId(tokenOrgId), {
      axisType: dto.axisType,
      code: dto.code,
      label: dto.label,
      parentId: dto.parentId,
      isActive: dto.isActive,
    });
    return toBudgetAxisEnvelope(axis);
  }

  @Patch(':axisId')
  @RequirePermission('budget.write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BudgetAxisEnvelopeResponse })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('axisId', new ParseUUIDPipe({ version: '4' })) axisId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Body() dto: UpdateBudgetAxisDto,
  ): Promise<BudgetAxisEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const axis = await this.axes.update(axisId, asTenantId(tokenOrgId), {
      label: dto.label,
      parentId: dto.parentId,
      isActive: dto.isActive,
    });
    return toBudgetAxisEnvelope(axis);
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
}
