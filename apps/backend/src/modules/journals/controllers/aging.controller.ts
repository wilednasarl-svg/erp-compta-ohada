import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { AgingService, type AgingReport, type AgingSideFilter } from '../services/aging.service';

/**
 * `AgingController` — échéancier / balance âgée des tiers.
 *
 *   GET /organizations/:id/aging?referenceDate=&side=&partnerAccountId=
 */
@ApiTags('Aging')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/aging')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class AgingController {
  constructor(private readonly aging: AgingService) {}

  @Get()
  @RequirePermission('journals.read')
  @ApiOperation({
    summary: 'Échéancier (balance âgée) des comptes tiers',
    description:
      'Solde ouvert des tiers ventilé par tranches d’âge (à échoir, 1-30, ' +
      '31-60, 61-90, +90 jours, sans échéance) à une date de référence.',
  })
  async getAging(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @CurrentOrg() org: CurrentOrgContext,
    @Query('referenceDate') referenceDate?: string,
    @Query('side') side?: string,
    @Query('partnerAccountId') partnerAccountId?: string,
  ): Promise<{ aging: AgingReport }> {
    const normalizedSide: AgingSideFilter =
      side === 'client' || side === 'fournisseur' ? side : 'all';
    const aging = await this.aging.getAging(asTenantId(org.id), {
      referenceDate,
      side: normalizedSide,
      partnerAccountId,
    });
    return { aging };
  }
}
