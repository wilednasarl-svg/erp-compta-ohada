import {
  Body,
  Controller,
  Delete,
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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
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
import { CreateBudgetLineDto } from '../dto/create-budget-line.dto';
import { UpdateBudgetLineDto } from '../dto/update-budget-line.dto';
import { TransitionBudgetLineDto } from '../dto/transition-budget-line.dto';
import { BudgetLineEnvelopeResponse, ListBudgetLinesResponse } from '../dto/responses';
import { toBudgetLineEnvelope, toListBudgetLines } from '../mappers/budget-response.mapper';
import { BudgetLinesService } from '../services/budget-lines.service';
import type { BudgetLineStatus, BudgetScenario, BudgetType } from '../types/budget.types';

@ApiTags('Budget — Lignes budgétaires')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/budget/lines')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BudgetLinesController {
  constructor(private readonly lines: BudgetLinesService) {}

  @Get()
  @RequirePermission('budget.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListBudgetLinesResponse })
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('fiscalYear') fiscalYear?: string,
    @Query('periodMonth') periodMonth?: string,
    @Query('budgetType') budgetType?: BudgetType,
    @Query('scenario') scenario?: BudgetScenario,
    @Query('accountCode') accountCode?: string,
    @Query('costCenterAxisId') costCenterAxisId?: string,
    @Query('projectAxisId') projectAxisId?: string,
    @Query('status') status?: BudgetLineStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ListBudgetLinesResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const { rows, total } = await this.lines.list(asTenantId(tokenOrgId), {
      fiscalYear: fiscalYear ? Number(fiscalYear) : undefined,
      periodMonth: periodMonth ? Number(periodMonth) : undefined,
      budgetType,
      scenario,
      accountCode,
      costCenterAxisId,
      projectAxisId,
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return toListBudgetLines(rows, total);
  }

  @Get(':lineId')
  @RequirePermission('budget.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BudgetLineEnvelopeResponse })
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('lineId', new ParseUUIDPipe({ version: '4' })) lineId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<BudgetLineEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const line = await this.lines.findById(lineId, asTenantId(tokenOrgId));
    return toBudgetLineEnvelope(line);
  }

  @Post()
  @RequirePermission('budget.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: BudgetLineEnvelopeResponse })
  async create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @Body() dto: CreateBudgetLineDto,
  ): Promise<BudgetLineEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const line = await this.lines.create(asTenantId(tokenOrgId), {
      fiscalYear: dto.fiscalYear,
      periodMonth: dto.periodMonth,
      budgetType: dto.budgetType,
      scenario: dto.scenario,
      accountCode: dto.accountCode,
      accountLabel: dto.accountLabel,
      costCenterAxisId: dto.costCenterAxisId,
      projectAxisId: dto.projectAxisId,
      agencyAxisId: dto.agencyAxisId,
      productAxisId: dto.productAxisId,
      amount: dto.amount,
      currency: dto.currency,
      exchangeRate: dto.exchangeRate,
      comment: dto.comment,
      hypothesis: dto.hypothesis,
      createdById: userId ?? null,
    });
    return toBudgetLineEnvelope(line);
  }

  @Patch(':lineId')
  @RequirePermission('budget.write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BudgetLineEnvelopeResponse })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('lineId', new ParseUUIDPipe({ version: '4' })) lineId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Body() dto: UpdateBudgetLineDto,
  ): Promise<BudgetLineEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const line = await this.lines.update(lineId, asTenantId(tokenOrgId), {
      accountLabel: dto.accountLabel,
      amount: dto.amount,
      currency: dto.currency,
      exchangeRate: dto.exchangeRate,
      comment: dto.comment,
      hypothesis: dto.hypothesis,
    });
    return toBudgetLineEnvelope(line);
  }

  @Post(':lineId/transition')
  @RequirePermission('budget.write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BudgetLineEnvelopeResponse })
  async transition(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('lineId', new ParseUUIDPipe({ version: '4' })) lineId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @Body() dto: TransitionBudgetLineDto,
  ): Promise<BudgetLineEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const line = await this.lines.transition(
      lineId,
      asTenantId(tokenOrgId),
      dto.targetStatus,
      userId ?? null,
    );
    return toBudgetLineEnvelope(line);
  }

  @Delete(':lineId')
  @RequirePermission('budget.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('lineId', new ParseUUIDPipe({ version: '4' })) lineId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<void> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    await this.lines.remove(lineId, asTenantId(tokenOrgId));
  }

  private assertOrgMatch(
    pathOrgId: string,
    tokenOrgId: string | undefined,
  ): asserts tokenOrgId is string {
    if (tokenOrgId === undefined || pathOrgId !== tokenOrgId) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, { message: 'Organization not found' });
    }
  }
}
