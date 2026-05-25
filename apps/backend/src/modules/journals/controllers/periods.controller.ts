import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { buildAuditRequestContext } from '../../../common/http/request-context.helper';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext, CurrentUserContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { CreateFiscalYearDto } from '../dto/create-fiscal-year.dto';
import { ReopenPeriodDto } from '../dto/reopen-period.dto';
import { PeriodsService } from '../services/periods.service';

@ApiTags('Accounting Periods')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/accounting-periods')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class PeriodsController {
  constructor(private readonly periods: PeriodsService) {}

  @Get()
  @RequirePermission('journals.read')
  @ApiOperation({ summary: 'Lister les periodes comptables' })
  async list(@Param('id', ParseUUIDPipe) _id: string, @CurrentOrg() org: CurrentOrgContext) {
    // Réponse enveloppée `{ periods: [...] }` — le frontend lit `data.periods`
    // (cf. apps/frontend/src/app/accounting-periods/page.tsx). Le retour direct
    // de l'array (tel que pratiqué auparavant) cassait avec "data is undefined"
    // dans React Query.
    const periods = await this.periods.listForOrg(asTenantId(org.id));
    return { periods };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('journals.close_period')
  @ApiOperation({ summary: 'Creer un exercice comptable avec ses sous-periodes' })
  async create(
    @Param('id', ParseUUIDPipe) _id: string,
    @CurrentOrg() org: CurrentOrgContext,
    @CurrentUser() user: CurrentUserContext,
    @Body() dto: CreateFiscalYearDto,
    @Req() req: Request,
  ) {
    const ctx = { ...buildAuditRequestContext(req), userId: user.id, organizationId: org.id };
    const period = await this.periods.createFiscalYear(
      asTenantId(org.id),
      dto.year,
      dto.split,
      user.id,
      ctx,
      { startDate: dto.startDate },
    );
    return { period };
  }

  @Post(':periodId/close')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('journals.close_period')
  @ApiOperation({ summary: 'Cloture une periode comptable' })
  async close(
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('periodId', ParseUUIDPipe) periodId: string,
    @CurrentOrg() org: CurrentOrgContext,
    @CurrentUser() user: CurrentUserContext,
    @Req() req: Request,
  ) {
    const ctx = { ...buildAuditRequestContext(req), userId: user.id, organizationId: org.id };
    await this.periods.closePeriod(asTenantId(org.id), periodId, user.id, ctx);
  }

  @Post(':periodId/reopen')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('journals.close_period')
  @ApiOperation({ summary: 'Reuvre une periode (motif obligatoire)' })
  async reopen(
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('periodId', ParseUUIDPipe) periodId: string,
    @CurrentOrg() org: CurrentOrgContext,
    @CurrentUser() user: CurrentUserContext,
    @Body() dto: ReopenPeriodDto,
    @Req() req: Request,
  ) {
    const ctx = { ...buildAuditRequestContext(req), userId: user.id, organizationId: org.id };
    await this.periods.reopenPeriod(asTenantId(org.id), periodId, dto.reason, user.id, ctx);
  }
}
