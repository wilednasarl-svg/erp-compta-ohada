import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { TaxBreakdownService, type TaxBreakdownReport } from '../services/tax-breakdown.service';

/**
 * `TaxBreakdownController` — ventilation TVA par code taxe.
 *
 *   GET /organizations/:id/tax-breakdown?from=&to=
 */
@ApiTags('Tax breakdown')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/tax-breakdown')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class TaxBreakdownController {
  constructor(private readonly taxBreakdown: TaxBreakdownService) {}

  @Get()
  @RequirePermission('journals.read')
  @ApiOperation({
    summary: 'Ventilation TVA par code taxe',
    description:
      'Cumuls débit / crédit / net par code taxe sur une période, à partir ' +
      'des lignes d’écritures validées portant un code taxe.',
  })
  async getBreakdown(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @CurrentOrg() org: CurrentOrgContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{ breakdown: TaxBreakdownReport }> {
    const breakdown = await this.taxBreakdown.getBreakdown(asTenantId(org.id), { from, to });
    return { breakdown };
  }
}
