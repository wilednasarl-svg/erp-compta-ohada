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
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

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
import { SyncActualsDto } from '../dto/sync-actuals.dto';
import { SyncActualsResponse } from '../dto/responses/sync-actuals.response';
import { BudgetActualsService } from '../services/budget-actuals.service';

@ApiTags('Budget — Réalisé')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/budget/actuals')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BudgetActualsController {
  constructor(private readonly actuals: BudgetActualsService) {}

  /**
   * (Re)génère le scénario REAL de l'exercice depuis les écritures validées.
   * Idempotent : peut être rejoué après toute nouvelle écriture.
   */
  @Post('sync')
  @RequirePermission('budget.write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SyncActualsResponse })
  async sync(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @Body() body: SyncActualsDto,
  ): Promise<SyncActualsResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const result = await this.actuals.syncActuals(
      asTenantId(tokenOrgId),
      body.fiscalYear,
      userId ?? null,
    );
    return {
      fiscalYear: result.fiscalYear,
      linesCreated: result.linesCreated,
      accountsCount: result.accountsCount,
      totalActual: result.totalActual,
    };
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
