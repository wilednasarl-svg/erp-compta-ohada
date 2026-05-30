import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';

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
import { GenerateAmortizationDto } from '../dto/generate-amortization.dto';
import { ListBudgetLinesResponse } from '../dto/responses';
import { toListBudgetLines } from '../mappers/budget-response.mapper';
import { BudgetCapexService } from '../services/budget-capex.service';

@ApiTags('Budget — CAPEX & amortissements')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/budget/capex')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BudgetCapexController {
  constructor(private readonly capex: BudgetCapexService) {}

  @Post('generate-amortization')
  @RequirePermission('budget.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: ListBudgetLinesResponse })
  async generate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @Body() dto: GenerateAmortizationDto,
  ): Promise<ListBudgetLinesResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const { created } = await this.capex.generateAmortization(asTenantId(tokenOrgId), {
      capexLineId: dto.capexLineId,
      serviceDate: dto.serviceDate,
      durationYears: dto.durationYears,
      dotationAccount: dto.dotationAccount,
      scenario: dto.scenario,
      createdById: userId ?? null,
    });
    return toListBudgetLines(created, created.length);
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
