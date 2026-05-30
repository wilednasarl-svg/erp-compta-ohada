import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { BudgetVarianceReportResponse } from '../dto/responses';
import { toBudgetVarianceReport } from '../mappers/budget-variance.mapper';
import { BudgetVarianceService } from '../services/budget-variance.service';
import type { BudgetGroupBy } from '../repositories/budget-variance.repository';
import type { BudgetScenario, BudgetType } from '../types/budget.types';

@ApiTags('Budget — Écarts & KPI')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/budget/variance')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BudgetVarianceController {
  constructor(private readonly variance: BudgetVarianceService) {}

  @Get()
  @RequirePermission('budget.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BudgetVarianceReportResponse })
  async report(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('fiscalYear') fiscalYear: string,
    @Query('budgetScenario') budgetScenario?: BudgetScenario,
    @Query('groupBy') groupBy?: BudgetGroupBy,
    @Query('budgetType') budgetType?: BudgetType,
    @Query('upToMonth') upToMonth?: string,
  ): Promise<BudgetVarianceReportResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const report = await this.variance.report(asTenantId(tokenOrgId), {
      fiscalYear: Number(fiscalYear),
      budgetScenario,
      groupBy,
      budgetType,
      upToMonth: upToMonth ? Number(upToMonth) : undefined,
    });
    return toBudgetVarianceReport(report);
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
